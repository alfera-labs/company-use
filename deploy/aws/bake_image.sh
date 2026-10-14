#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
readonly here
readonly usage='use: deploy/aws/bake_image.sh <version> <amd64|arm64> [<first region> <more regions>...]'
readonly version="${1:?$usage}"
readonly architecture="${2:?$usage}"
shift 2
regions=("$@")
[ "${#regions[@]}" -gt 0 ] || regions=(eu-central-1 us-east-1 ap-southeast-1 ap-southeast-2)
readonly bake_region="${regions[0]}"
readonly image_name="alfera-$version-$architecture"
readonly resource_tag="${RESOURCE_TAG:-alfera-image}"
readonly images_file="$here/server_images.txt"
readonly most_minutes_to_bake=40

case "$architecture" in
  amd64) bake_instance_type='c7i-flex.large' ;;
  arm64) bake_instance_type='c7g.large' ;;
  *) echo "$usage" >&2; exit 2 ;;
esac

say() {
  printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*" >&2
}

tags_for() {
  printf 'ResourceType=%s,Tags=[{Key=Name,Value=%s},{Key=%s,Value=%s}]' "$1" "$image_name" "$resource_tag" "$version"
}

base_image() {
  aws ssm get-parameter --region "$bake_region" --output text --query Parameter.Value \
    --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/$architecture/hvm/ebs-gp3/ami-id"
}

user_data_file() {
  local file name value
  file="$(mktemp)"
  chmod 0600 "$file"
  printf '#!/bin/bash\n' >"$file"
  for name in ALFERA_VERSION ALFERA_INSTALL_FILES_URL ALFERA_REGISTRY_USER ALFERA_REGISTRY_TOKEN; do
    [ "$name" = ALFERA_VERSION ] && value="$version" || value="${!name:-}"
    printf "export %s='%s'\n" "$name" "$value" >>"$file"
  done
  tail -n +2 "$here/bake_image_on_the_server.sh" >>"$file"
  printf '%s' "$file"
}

start_the_bake_server() {
  local user_data instance
  user_data="$(user_data_file)"
  instance="$(aws ec2 run-instances --region "$bake_region" --image-id "$(base_image)" \
    --instance-type "$bake_instance_type" --user-data "file://$user_data" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}' \
    --metadata-options HttpTokens=required \
    --tag-specifications "$(tags_for instance)" "$(tags_for volume)" \
    --output text --query 'Instances[0].InstanceId')"
  rm -f "$user_data"
  printf '%s' "$instance"
}

bake_lines_of() {
  aws ec2 get-console-output --region "$bake_region" --instance-id "$1" --latest \
    --output text --query Output | grep 'alfera bake:' || true
}

wait_until_the_bake_ends() {
  local instance="$1" waited=0 lines=''
  while [ "$waited" -lt "$((most_minutes_to_bake * 60))" ]; do
    lines="$(bake_lines_of "$instance")"
    if printf '%s\n' "$lines" | grep -qE 'alfera bake: (done|failed)'; then
      printf '%s\n' "$lines" >&2
      printf '%s\n' "$lines" | grep -q "alfera bake: done $version"
      return
    fi
    sleep 15
    waited=$((waited + 15))
  done
  say "the bake did not end within $most_minutes_to_bake minutes"
  return 1
}

wait_for_image() {
  local region="$1" image="$2" state=''
  while [ "$state" != available ]; do
    sleep 15
    state="$(aws ec2 describe-images --region "$region" --image-ids "$image" --output text --query 'Images[0].State')"
    [ "$state" != failed ] || { say "image $image in $region failed"; return 1; }
  done
}

make_the_image() {
  local instance="$1" image
  image="$(aws ec2 create-image --region "$bake_region" --instance-id "$instance" --name "$image_name" \
    --description "Alfera $version for $architecture: Docker, the install files and the images" \
    --tag-specifications "$(tags_for image)" "$(tags_for snapshot)" --output text --query ImageId)"
  wait_for_image "$bake_region" "$image"
  printf '%s' "$image"
}

require_metadata_tokens() {
  aws ec2 modify-image-attribute --region "$1" --image-id "$2" --imds-support '{"Value":"v2.0"}' || true
}

start_the_copy() {
  aws ec2 copy-image --region "$1" --source-region "$bake_region" --source-image-id "$2" --name "$image_name" \
    --tag-specifications "$(tags_for image)" "$(tags_for snapshot)" --output text --query ImageId
}

record_the_image() {
  local region="$1" image="$2" others
  others="$(awk -v region="$region" -v arch="$architecture" '!($1 == region && $2 == arch)' "$images_file" 2>/dev/null || true)"
  { [ -z "$others" ] || printf '%s\n' "$others"; printf '%s %s %s %s\n' "$region" "$architecture" "$image" "$version"; } |
    sort >"$images_file.next"
  mv "$images_file.next" "$images_file"
  say "$region $architecture $image"
}

bake() {
  local instance image region copy copies=()
  instance="$(start_the_bake_server)"
  say "baking $image_name on $instance in $bake_region"
  wait_until_the_bake_ends "$instance" ||
    { aws ec2 terminate-instances --region "$bake_region" --instance-ids "$instance" >/dev/null; return 1; }
  image="$(make_the_image "$instance")"
  aws ec2 terminate-instances --region "$bake_region" --instance-ids "$instance" >/dev/null
  require_metadata_tokens "$bake_region" "$image"
  record_the_image "$bake_region" "$image"
  for region in "${regions[@]:1}"; do
    copies+=("$region $(start_the_copy "$region" "$image")")
  done
  for copy in ${copies[@]+"${copies[@]}"}; do
    wait_for_image "${copy% *}" "${copy#* }"
    require_metadata_tokens "${copy% *}" "${copy#* }"
    record_the_image "${copy% *}" "${copy#* }"
  done
  "$here/write_template.sh"
}

bake

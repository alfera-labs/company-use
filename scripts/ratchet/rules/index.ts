import type { RatchetRule } from '@scripts/ratchet/rule_types';
import { import_direction_rule } from '@scripts/ratchet/rules/import-direction';
import { max_file_lines_rule } from '@scripts/ratchet/rules/max_file_lines';
import { max_function_lines_rule } from '@scripts/ratchet/rules/max_function_lines';
import { no_await_in_loop_rule } from '@scripts/ratchet/rules/no_await_in_loop';
import { no_empty_catch_rule } from '@scripts/ratchet/rules/no_empty_catch';
import { no_generic_value_readers_rule } from '@scripts/ratchet/rules/no_generic_value_readers';
import { no_hedge_names_rule } from '@scripts/ratchet/rules/no_hedge_names';
import { no_new_comments_rule } from '@scripts/ratchet/rules/no_new_comments';
import { no_raw_process_env_rule } from '@scripts/ratchet/rules/no_raw_process_env';
import { no_relative_imports_rule } from '@scripts/ratchet/rules/no_relative_imports';
import { no_type_escape_hatches_rule } from '@scripts/ratchet/rules/no_type_escape_hatches';
import { no_workaround_markers_rule } from '@scripts/ratchet/rules/no_workaround_markers';
import { strict_boundary_schemas_rule } from '@scripts/ratchet/rules/strict_boundary_schemas';
import { no_json_parse_cast_rule } from '@scripts/ratchet/rules/no_json_parse_cast';
import { no_double_cast_rule } from '@scripts/ratchet/rules/no_double_cast';
import { no_mocked_database_rule } from '@scripts/ratchet/rules/no_mocked_database';
import { no_own_module_mocks_rule } from '@scripts/ratchet/rules/no_own_module_mocks';
import { routes_and_tools_use_services_rule } from '@scripts/ratchet/rules/routes_and_tools_use_services';
import { update_sets_lifecycle_columns_rule } from '@scripts/ratchet/rules/update_sets_lifecycle_columns';
import { one_json_body_reader_rule } from '@scripts/ratchet/rules/one_json_body_reader';
import { metadata_writes_merge_rule } from '@scripts/ratchet/rules/metadata_writes_merge';
import { versioned_routes_rule } from '@scripts/ratchet/rules/versioned_routes';
import { no_ad_platform_scripts_rule } from '@scripts/ratchet/rules/no_ad_platform_scripts';
import { query_keys_from_one_module_rule } from '@scripts/ratchet/rules/query_keys_from_one_module';
import { no_direct_secure_context_apis_rule } from '@scripts/ratchet/rules/no_direct_secure_context_apis';

export const ratchet_rules: readonly RatchetRule[] = [
  no_new_comments_rule,
  no_workaround_markers_rule,
  no_type_escape_hatches_rule,
  no_raw_process_env_rule,
  no_relative_imports_rule,
  no_hedge_names_rule,
  no_empty_catch_rule,
  max_function_lines_rule,
  max_file_lines_rule,
  no_await_in_loop_rule,
  no_generic_value_readers_rule,
  import_direction_rule,
  strict_boundary_schemas_rule,
  no_json_parse_cast_rule,
  no_double_cast_rule,
  no_mocked_database_rule,
  no_own_module_mocks_rule,
  routes_and_tools_use_services_rule,
  update_sets_lifecycle_columns_rule,
  one_json_body_reader_rule,
  metadata_writes_merge_rule,
  versioned_routes_rule,
  no_ad_platform_scripts_rule,
  query_keys_from_one_module_rule,
  no_direct_secure_context_apis_rule,
];

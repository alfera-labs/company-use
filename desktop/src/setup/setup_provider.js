// Where the person rents the server, and what they click there. One record, so the steps of
// "Create your server" change by replacing this record and nothing else.
// The names in quotes are the ones on the pages of the company. When the company renames a
// button, the name changes here. {size} in a step becomes the size to pick: the usual one, or
// the bigger one after a server turned out too small.
const image_to_pick = 'Ubuntu 24.04';
const size_to_pick = '4 GB of memory';
const field_for_the_key = 'SSH key';

const setup_provider = {
  name: 'DigitalOcean',
  website: 'digitalocean.com',
  price_words: '24 dollars a month',
  image_to_pick,
  size_to_pick,
  // The size to pick when the first one was too small for the build.
  bigger_size_to_pick: '8 GB of memory',
  bigger_price_words: '48 dollars a month',
  size_id: 's-2vcpu-4gb',
  bigger_size_id: 's-4vcpu-8gb',
  field_for_the_key,
  steps: [
    'Open digitalocean.com in your browser and make an account. It asks for a payment card.',
    'Press the green "Create" button at the top, then "Droplet". That is their word for a server.',
    `Under "Choose an image", pick ${image_to_pick}.`,
    'Under "Choose a Droplet Plan", pick "Basic", then the size with {size}.',
    `Under "Choose Authentication Method", pick "${field_for_the_key}". Press "Add SSH Key" and paste the SSH key from above.`,
    'Press "Create Droplet". Wait until the page shows the IP address of the new server.',
  ],
};

if (typeof module !== 'undefined') module.exports = { setup_provider };

const fs = require('node:fs');
const path = require('node:path');

// A mistake the agent can read and correct: a wrong path, a file that is too big, text not found.
class FolderToolError extends Error {}

// A path that does not exist yet has no real path, so resolve the nearest folder that does exist
// and add the rest back. This is what stops a link inside the folder from pointing outside it.
function real_path_of_nearest_existing_parent(target) {
  let existing = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), path.relative(existing, target));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(existing);
    if (parent === existing) return target;
    existing = parent;
  }
}

function resolve_inside_folder(folder, relative_path = '.') {
  const root = fs.realpathSync(folder);
  const target = real_path_of_nearest_existing_parent(path.resolve(root, relative_path));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new FolderToolError(`"${relative_path}" is outside the folder. Use a path inside it.`);
  }
  return target;
}

function path_from_folder(folder, absolute_path) {
  return path.relative(fs.realpathSync(folder), absolute_path) || '.';
}

module.exports = { FolderToolError, resolve_inside_folder, path_from_folder };

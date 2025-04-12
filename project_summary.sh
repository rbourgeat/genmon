#!/bin/bash

OUTPUT_FILE="project_summary.txt"

# Check if in a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: This is not a Git repository."
  exit 1
fi

# Clear or create the output file
> "$OUTPUT_FILE"

# Print the file tree of Git-tracked files
echo "==== Project File Tree ====" >> "$OUTPUT_FILE"
TMP_DIR=$(mktemp -d)

# Reconstruct file structure from git-tracked files
git ls-files | while read -r file; do
  mkdir -p "$TMP_DIR/$(dirname "$file")"
  touch "$TMP_DIR/$file"
done

tree "$TMP_DIR" >> "$OUTPUT_FILE"
rm -rf "$TMP_DIR"

# Add file contents
echo -e "\n\n==== File Contents ====" >> "$OUTPUT_FILE"

git ls-files | while read -r file; do
  echo -e "\n\n--- FILE: $file ---" >> "$OUTPUT_FILE"
  cat "$file" >> "$OUTPUT_FILE"
done

echo "✅ Done! See $OUTPUT_FILE"
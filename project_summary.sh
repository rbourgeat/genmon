#!/bin/bash

# Output file
OUTPUT_FILE="project_summary.txt"

# Clear the output file if it exists
> "$OUTPUT_FILE"

# === TREE STRUCTURE ===
echo "==== Project File Tree ====" >> "$OUTPUT_FILE"
tree -a -I "node_modules|.git|package-lock.json|.gitignore|LICENSE|project_summary.sh|$OUTPUT_FILE|public/assets" >> "$OUTPUT_FILE"

echo -e "\n\n==== File Contents ====" >> "$OUTPUT_FILE"

# === FILE CONTENTS ===
find . -type f \
  ! -path "./node_modules/*" \
  ! -path "./.git/*" \
  ! -path "./public/assets/*" \
  ! -name "package-lock.json" \
  ! -name ".gitignore" \
  ! -name "LICENSE" \
  ! -name "project_summary.sh" \
  ! -name "$OUTPUT_FILE" | while read -r file; do
    echo -e "\n\n--- FILE: $file ---" >> "$OUTPUT_FILE"
    cat "$file" >> "$OUTPUT_FILE"
done

echo "✅ Done! See $OUTPUT_FILE for the full project summary."
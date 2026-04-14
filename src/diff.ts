function truncateFileSection(
  fileLines: string[],
  fileName: string,
  maxLines: number,
): string[] {
  if (fileLines.length <= maxLines) {
    return fileLines;
  }

  const contentLines = fileLines.filter((line) => !line.startsWith("@@"));
  const hunkHeaders = fileLines.filter((line) => line.startsWith("@@"));

  if (contentLines.length <= maxLines) {
    return fileLines;
  }

  const showAtStart = Math.floor(maxLines * 0.6);
  const showAtEnd = Math.floor(maxLines * 0.4);
  const truncatedCount = contentLines.length - showAtStart - showAtEnd;

  return [
    ...hunkHeaders,
    ...contentLines.slice(0, showAtStart),
    "",
    `[*** FILE TRUNCATED: ${truncatedCount} lines hidden from ${fileName} ***]`,
    `[*** File had ${contentLines.length} total lines, showing first ${showAtStart} and last ${showAtEnd} ***]`,
    `[*** Use maxLinesPerFile=0 to see complete diff ***]`,
    "",
    ...contentLines.slice(-showAtEnd),
  ];
}

export function truncateDiff(
  diffContent: string,
  maxLinesPerFile: number,
): string {
  if (!maxLinesPerFile || maxLinesPerFile <= 0) {
    return diffContent;
  }

  const lines = diffContent.split("\n");
  const result: string[] = [];
  let currentFileLines: string[] = [];
  let currentFileName = "";
  let inFileContent = false;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentFileLines.length > 0) {
        result.push(
          ...truncateFileSection(
            currentFileLines,
            currentFileName,
            maxLinesPerFile,
          ),
        );
        currentFileLines = [];
      }

      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFileName = match ? match[2] : "unknown";
      inFileContent = false;
      result.push(line);
    } else if (
      line.startsWith("index ") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      result.push(line);
    } else if (line.startsWith("@@")) {
      inFileContent = true;
      currentFileLines.push(line);
    } else if (inFileContent) {
      currentFileLines.push(line);
    } else {
      result.push(line);
    }
  }

  if (currentFileLines.length > 0) {
    result.push(
      ...truncateFileSection(
        currentFileLines,
        currentFileName,
        maxLinesPerFile,
      ),
    );
  }

  return result.join("\n");
}

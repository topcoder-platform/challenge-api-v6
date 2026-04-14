"use strict";

const normalizeLegacyText = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "null") {
    return null;
  }
  return normalized;
};

const isUsableProblemText = (value) => Boolean(normalizeLegacyText(value));

const decodeHtmlEntities = (value) =>
  String(value || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");

const stripHiddenSections = (xml) =>
  String(xml || "")
    .replace(/<test_cases?\b[^>]*>[\s\S]*?<\/test_cases?>/gi, " ")
    .replace(/<testcase[s]?\b[^>]*>[\s\S]*?<\/testcase[s]?>/gi, " ")
    .replace(/<test\b[^>]*>[\s\S]*?<\/test>/gi, " ")
    .replace(
      /<([a-z0-9_:-]*(?:hidden|internal|private)[a-z0-9_:-]*)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    )
    .replace(/<([a-z0-9_:-]*(?:hidden|internal|private)[a-z0-9_:-]*)\b[^>]*\/>/gi, " ")
    .replace(
      /<test_case\b[^>]*\b(?:hidden|internal|private)\s*=\s*["']?(?:1|true|yes)["']?[^>]*>[\s\S]*?<\/test_case>/gi,
      " "
    )
    .replace(
      /<test_case\b[^>]*\b(?:public|example|sample)\s*=\s*["']?(?:0|false|no)["']?[^>]*>[\s\S]*?<\/test_case>/gi,
      " "
    );

const normalizeWhitespace = (value) =>
  String(value || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const MAX_COMPONENT_MARKDOWN_LENGTH = 20000;

const toInlineText = (xmlLike) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      String(xmlLike || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
    )
  );

const convertComponentXmlToMarkdown = (value) => {
  const normalized = normalizeLegacyText(value);
  if (!normalized) {
    return null;
  }

  let text = normalized
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/g, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  text = stripHiddenSections(text);

  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, depth, content) => {
    const heading = toInlineText(content);
    if (!heading) {
      return "\n\n";
    }
    return `\n\n${"#".repeat(Number.parseInt(depth, 10))} ${heading}\n\n`;
  });

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|section|problem_statement|statement|description|notes|example)>/gi, "\n\n")
    .replace(/<\/(tr|table|ul|ol|pre|code)>/gi, "\n");

  text = decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }
      return !/\b(?:hidden|internal)\b.*\btest\s*case/i.test(line);
    });

  const markdown = normalizeWhitespace(lines.join("\n"));
  if (!markdown) {
    return null;
  }
  if (!/[A-Za-z0-9]/.test(markdown)) {
    return null;
  }
  if (markdown.length > MAX_COMPONENT_MARKDOWN_LENGTH) {
    const truncated = markdown
      .slice(0, MAX_COMPONENT_MARKDOWN_LENGTH)
      .replace(/\s+\S*$/, "")
      .trim();
    return `${truncated}\n\n...`;
  }
  return markdown;
};

const isUsableComponentMarkdown = (value) => Boolean(normalizeLegacyText(value));

const resolveDescriptionFromMappedLegacySources = ({
  componentIds = [],
  componentProblemIdById = new Map(),
  problemTextByProblemId = new Map(),
  componentTextByComponentId = new Map(),
}) => {
  for (const componentId of componentIds) {
    const problemId = componentProblemIdById.get(componentId);
    if (!problemId) {
      continue;
    }
    const candidateProblemText = problemTextByProblemId.get(problemId);
    if (!isUsableProblemText(candidateProblemText)) {
      continue;
    }
    return {
      source: "legacy-problem-text",
      problemId,
      problemText: String(candidateProblemText),
      componentId: null,
      componentTextMarkdown: null,
    };
  }

  for (const componentId of componentIds) {
    const candidateComponentText = componentTextByComponentId.get(componentId);
    const componentTextMarkdown = convertComponentXmlToMarkdown(candidateComponentText);
    if (!isUsableComponentMarkdown(componentTextMarkdown)) {
      continue;
    }
    return {
      source: "legacy-component-text-markdown",
      problemId: null,
      problemText: null,
      componentId,
      componentTextMarkdown,
    };
  }

  return {
    source: null,
    problemId: null,
    problemText: null,
    componentId: null,
    componentTextMarkdown: null,
  };
};

module.exports = {
  isUsableProblemText,
  isUsableComponentMarkdown,
  convertComponentXmlToMarkdown,
  resolveDescriptionFromMappedLegacySources,
};

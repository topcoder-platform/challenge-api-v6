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

/**
 * Decodes legacy `/ASCII123/` placeholders from Informix exports.
 *
 * @param {string | null | undefined} value legacy component/problem text
 * @returns {string} decoded text used by the marathon importer description pipeline
 * @throws {Error} This helper does not throw; unknown placeholders are preserved verbatim.
 */
const decodeLegacyAsciiPlaceholders = (value) =>
  String(value || "").replace(/\/ASCII(\d{1,3})\//g, (match, asciiCode) => {
    const parsed = Number.parseInt(asciiCode, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 127) {
      return match;
    }
    if (parsed === 13) {
      return "";
    }
    return String.fromCharCode(parsed);
  });

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

const normalizeWhitespacePreservingCodeBlocks = (value) =>
  String(value || "")
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => {
      if (!segment) {
        return "";
      }
      if (segment.startsWith("```")) {
        return segment.trim();
      }
      return normalizeWhitespace(segment);
    })
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const MAX_COMPONENT_MARKDOWN_LENGTH = 20000;
const TOPCODER_PUBLIC_EXAMPLE_PATTERN =
  /\bexample\s*=\s*["']?(?:1|true|yes)["']?/i;

const toInlineText = (xmlLike) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      decodeLegacyAsciiPlaceholders(
        String(xmlLike || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
      )
    )
  );

const escapeRegExp = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Extracts the first matching XML tag body from legacy component text.
 *
 * @param {string | null | undefined} xml source XML from the legacy component export
 * @param {string} tagName XML tag name to match, including hyphenated names
 * @returns {string | null} the first matching tag body, or null when absent
 * @throws {Error} This helper does not throw; malformed XML simply returns null.
 */
const extractFirstTagContent = (xml, tagName) => {
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`,
    "i"
  );
  const match = pattern.exec(String(xml || ""));
  return match ? match[1] : null;
};

/**
 * Extracts every matching XML tag body from legacy component text.
 *
 * @param {string | null | undefined} xml source XML from the legacy component export
 * @param {string} tagName XML tag name to match, including hyphenated names
 * @returns {string[]} matching tag bodies in document order for importer rendering
 * @throws {Error} This helper does not throw; malformed XML yields an empty array.
 */
const extractTagContents = (xml, tagName) => {
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`,
    "gi"
  );
  return Array.from(String(xml || "").matchAll(pattern), (match) => match[1]);
};

/**
 * Extracts full XML element blocks while preserving opening-tag attributes.
 *
 * @param {string | null | undefined} xml source XML from the legacy component export
 * @param {string} tagName XML tag name to match, including hyphenated names
 * @returns {string[]} matching XML blocks used by the importer for structured section parsing
 * @throws {Error} This helper does not throw; malformed XML yields an empty array.
 */
const extractTagBlocks = (xml, tagName) => {
  const pattern = new RegExp(
    `<${escapeRegExp(tagName)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tagName)}>`,
    "gi"
  );
  return Array.from(String(xml || "").matchAll(pattern), (match) => match[0]);
};

const stripXmlScaffolding = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/g, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

const stripAllTags = (value) => String(value || "").replace(/<[^>]+>/g, " ");

const looksLikeHtmlContent = (value) => {
  const normalized = normalizeLegacyText(value);
  if (!normalized) {
    return false;
  }
  return /<\/?[a-z][a-z0-9:_-]*\b[^>]*>/i.test(normalized);
};

const wrapSection = (heading, body) => {
  const normalizedBody = normalizeWhitespacePreservingCodeBlocks(body);
  if (!normalizedBody) {
    return null;
  }
  return `## ${heading}\n\n${normalizedBody}`;
};

const buildCodeBlock = (value) => {
  const normalized = normalizeWhitespace(
    decodeHtmlEntities(decodeLegacyAsciiPlaceholders(stripAllTags(String(value || ""))))
  );
  if (!normalized) {
    return null;
  }
  return `\`\`\`text\n${normalized}\n\`\`\``;
};

/**
 * Converts a rich XML or HTML subsection into Markdown while preserving code-style blocks.
 *
 * @param {string | null | undefined} value subsection text extracted from legacy component XML
 * @returns {string | null} Markdown used by the marathon importer for v6 challenge descriptions
 * @throws {Error} This helper does not throw; malformed markup is flattened into readable text.
 */
const convertRichTextSectionToMarkdown = (value) => {
  const normalized = normalizeLegacyText(value);
  if (!normalized) {
    return null;
  }

  const codeBlocks = [];
  const stashCodeBlock = (content) => {
    const token = `@@TC_CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(content);
    return `\n\n${token}\n\n`;
  };

  let text = stripHiddenSections(stripXmlScaffolding(normalized));
  text = decodeHtmlEntities(decodeLegacyAsciiPlaceholders(text));

  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const codeBlock = buildCodeBlock(content);
    return codeBlock ? stashCodeBlock(codeBlock) : "\n\n";
  });

  text = text
    .replace(/<br\s*\/?>\s*(?:<\/br>)?/gi, "\n")
    .replace(/<(tt|code|type)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
      const inline = toInlineText(content);
      return inline ? `\`${inline}\`` : "";
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
      const inline = toInlineText(content);
      return inline ? `**${inline}**` : "";
    })
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
      const inline = toInlineText(content);
      return inline ? `*${inline}*` : "";
    })
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, (_, content) => {
      const inline = toInlineText(content);
      return inline ? `^${inline}^` : "";
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|section|example|note|item)>/gi, "\n\n")
    .replace(/<(p|div|section|example|note|item)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n");

  let markdown = normalizeWhitespacePreservingCodeBlocks(text);
  codeBlocks.forEach((codeBlock, index) => {
    markdown = markdown.replace(`@@TC_CODE_BLOCK_${index}@@`, codeBlock);
  });

  return normalizeWhitespacePreservingCodeBlocks(markdown);
};

/**
 * Builds a Markdown signature section from Topcoder problem XML.
 *
 * @param {string | null | undefined} signatureXml the `<signature>` block from legacy component XML
 * @returns {string | null} a Markdown class/method summary for imported challenge descriptions
 * @throws {Error} This helper does not throw; malformed signatures are partially rendered when possible.
 */
const buildSignatureMarkdown = (signatureXml) => {
  const normalizedSignature = normalizeLegacyText(signatureXml);
  if (!normalizedSignature) {
    return null;
  }

  const sections = [];
  const className = toInlineText(extractFirstTagContent(normalizedSignature, "class"));
  if (className) {
    sections.push(`## Class\n\n\`${className}\``);
  }

  const methodBlocks = extractTagBlocks(normalizedSignature, "method");
  const methods = methodBlocks
    .map((methodBlock) => {
      const methodName = toInlineText(extractFirstTagContent(methodBlock, "name"));
      const returnType = toInlineText(
        extractFirstTagContent(extractFirstTagContent(methodBlock, "return"), "type")
      );
      const params = extractTagBlocks(extractFirstTagContent(methodBlock, "params"), "param")
        .map((paramBlock) => {
          const type = toInlineText(extractFirstTagContent(paramBlock, "type"));
          const name = toInlineText(extractFirstTagContent(paramBlock, "name"));
          if (type && name) {
            return `${type} ${name}`;
          }
          return type || name || null;
        })
        .filter(Boolean);

      if (!methodName) {
        return null;
      }

      const signature = `${returnType ? `${returnType} ` : ""}${methodName}(${params.join(", ")})`;
      return `- \`${signature}\``;
    })
    .filter(Boolean);

  if (methods.length > 0) {
    sections.push(`## Methods\n\n${methods.join("\n")}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
};

/**
 * Builds a bullet-list Markdown section from repeated XML child tags.
 *
 * @param {string} heading section heading to render in the imported challenge description
 * @param {string | null | undefined} xml parent XML block containing repeated child elements
 * @param {string} itemTagName child tag name to extract from the parent block
 * @returns {string | null} Markdown bullet list, or null when the section is empty
 * @throws {Error} This helper does not throw; malformed XML yields an empty section.
 */
const buildListSectionMarkdown = (heading, xml, itemTagName) => {
  const items = extractTagContents(xml, itemTagName)
    .map((item) => toInlineText(item))
    .filter(Boolean)
    .map((item) => `- ${item}`);

  if (items.length === 0) {
    return null;
  }

  return `## ${heading}\n\n${items.join("\n")}`;
};

/**
 * Builds a Markdown examples section from legacy Topcoder `<test-cases>` XML.
 *
 * @param {string | null | undefined} testCasesXml the `<test-cases>` block from legacy component XML
 * @returns {string | null} public example Markdown for imported challenge descriptions
 * @throws {Error} This helper does not throw; malformed test-case XML is skipped.
 */
const buildExamplesMarkdown = (testCasesXml) => {
  const normalized = normalizeLegacyText(testCasesXml);
  if (!normalized) {
    return null;
  }

  const testCaseMatches = Array.from(
    String(normalized).matchAll(/<test-case\b([^>]*)>([\s\S]*?)<\/test-case>/gi),
    (match) => ({
      attrs: match[1] || "",
      body: match[2] || "",
    })
  );
  if (testCaseMatches.length === 0) {
    return null;
  }

  const hasExplicitExamples = testCaseMatches.some((testCase) =>
    TOPCODER_PUBLIC_EXAMPLE_PATTERN.test(testCase.attrs)
  );
  const selectedCases = hasExplicitExamples
    ? testCaseMatches.filter((testCase) => TOPCODER_PUBLIC_EXAMPLE_PATTERN.test(testCase.attrs))
    : testCaseMatches;

  const renderedCases = selectedCases
    .map((testCase, index) => {
      const sections = [`### Example ${index + 1}`];
      const input = buildCodeBlock(extractFirstTagContent(testCase.body, "input"));
      if (input) {
        sections.push(`**Input**\n\n${input}`);
      }
      const rawOutput = extractFirstTagContent(testCase.body, "output");
      const output =
        /<[a-z][a-z0-9:_-]*\b/i.test(
          decodeHtmlEntities(decodeLegacyAsciiPlaceholders(String(rawOutput || "")))
        )
          ? convertRichTextSectionToMarkdown(rawOutput)
          : buildCodeBlock(rawOutput);
      if (output) {
        sections.push(`**Output**\n\n${output}`);
      }
      const annotation = convertRichTextSectionToMarkdown(
        extractFirstTagContent(testCase.body, "annotation")
      );
      if (annotation) {
        sections.push(`**Explanation**\n\n${annotation}`);
      }
      return sections.length > 1 ? sections.join("\n\n") : null;
    })
    .filter(Boolean);

  if (renderedCases.length === 0) {
    return null;
  }

  return `## Examples\n\n${renderedCases.join("\n\n")}`;
};

const convertStructuredTopcoderProblemXmlToMarkdown = (value) => {
  const normalized = normalizeLegacyText(value);
  if (!normalized || !/<problem\b/i.test(normalized)) {
    return null;
  }

  const sections = [
    buildSignatureMarkdown(extractFirstTagContent(normalized, "signature")),
    wrapSection(
      "Statement",
      convertRichTextSectionToMarkdown(extractFirstTagContent(normalized, "intro"))
    ),
    wrapSection(
      "Specification",
      convertRichTextSectionToMarkdown(extractFirstTagContent(normalized, "spec"))
    ),
    buildListSectionMarkdown("Notes", extractFirstTagContent(normalized, "notes"), "note"),
    buildListSectionMarkdown(
      "Constraints",
      extractFirstTagContent(normalized, "constraints"),
      "constraint"
    ),
    buildExamplesMarkdown(extractFirstTagContent(normalized, "test-cases")),
  ].filter(Boolean);

  const memLimit = toInlineText(extractFirstTagContent(normalized, "memlimit"));
  const hasMemoryLimitNote = sections.some((section) => /memory limit/i.test(section));
  if (memLimit && !hasMemoryLimitNote) {
    sections.push(`## Limits\n\n- Memory limit: ${memLimit} MB.`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
};

const truncateMarkdown = (markdown) => {
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

const convertFallbackXmlToMarkdown = (value) => {
  const normalized = normalizeLegacyText(value);
  if (!normalized) {
    return null;
  }

  let text = stripXmlScaffolding(normalized);
  text = stripHiddenSections(text);

  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, depth, content) => {
    const heading = toInlineText(content);
    if (!heading) {
      return "\n\n";
    }
    return `\n\n${"#".repeat(Number.parseInt(depth, 10))} ${heading}\n\n`;
  });

  text = text
    .replace(/<br\s*\/?>\s*(?:<\/br>)?/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|section|problem_statement|statement|description|notes|example)>/gi, "\n\n")
    .replace(/<\/(tr|table|ul|ol|pre|code)>/gi, "\n");

  text = decodeHtmlEntities(decodeLegacyAsciiPlaceholders(text))
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

  return normalizeWhitespace(lines.join("\n")) || null;
};

const convertComponentXmlToMarkdown = (value) => {
  const markdown =
    convertStructuredTopcoderProblemXmlToMarkdown(value) ||
    convertFallbackXmlToMarkdown(value);
  return truncateMarkdown(markdown);
};

const isUsableComponentMarkdown = (value) => Boolean(normalizeLegacyText(value));

const isRenderableProblemText = (value) =>
  Boolean(normalizeLegacyText(value)) && looksLikeHtmlContent(value);

/**
 * Resolves the stored description body and format from planning counters.
 *
 * @param {object | null | undefined} counters per-round planning counters from the importer
 * @returns {{ description: string, descriptionFormat: string, source: string } | null} the description payload for create/rerun writes
 * @throws {Error} This helper does not throw; it returns null when no usable description candidate exists.
 */
const resolveDescriptionCandidateFromCounters = (counters) => {
  const candidateProblemText = counters && counters.descriptionProblemText;
  if (isUsableProblemText(candidateProblemText)) {
    return {
      description: String(candidateProblemText),
      descriptionFormat: isRenderableProblemText(candidateProblemText) ? "html" : "markdown",
      source: "legacy-problem-text",
    };
  }

  const candidateComponentTextMarkdown =
    counters && counters.descriptionComponentTextMarkdown;
  if (isUsableComponentMarkdown(candidateComponentTextMarkdown)) {
    return {
      description: String(candidateComponentTextMarkdown),
      descriptionFormat: "markdown",
      source: "legacy-component-text-markdown",
    };
  }

  return null;
};

const resolveDescriptionFromMappedLegacySources = ({
  componentIds = [],
  componentProblemIdById = new Map(),
  problemTextByProblemId = new Map(),
  componentTextByComponentId = new Map(),
}) => {
  const nonHtmlProblemTextFallbacks = [];

  for (const componentId of componentIds) {
    const problemId = componentProblemIdById.get(componentId);
    if (!problemId) {
      continue;
    }
    const candidateProblemText = problemTextByProblemId.get(problemId);
    if (!isUsableProblemText(candidateProblemText)) {
      continue;
    }
    if (!isRenderableProblemText(candidateProblemText)) {
      nonHtmlProblemTextFallbacks.push({
        source: "legacy-problem-text",
        problemId,
        problemText: String(candidateProblemText),
        componentId: null,
        componentTextMarkdown: null,
      });
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

  if (nonHtmlProblemTextFallbacks.length > 0) {
    return nonHtmlProblemTextFallbacks[0];
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
  isRenderableProblemText,
  convertComponentXmlToMarkdown,
  resolveDescriptionCandidateFromCounters,
  resolveDescriptionFromMappedLegacySources,
};

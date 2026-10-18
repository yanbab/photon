const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_SRC_DIR = fs.existsSync(path.join(ROOT_DIR, 'docs-src')) 
  ? path.join(ROOT_DIR, 'docs-src') 
  : path.join(ROOT_DIR, 'docs');
const OUTPUT_DIR = fs.existsSync(path.join(ROOT_DIR, 'docs-src')) 
  ? path.join(ROOT_DIR, 'docs') 
  : path.join(ROOT_DIR, '_site');

// Site metadata (from _config.yml)
const siteMeta = {
  name: 'Photon',
  authors: 'Connor Sears',
  description: 'Build desktop apps with simple HTML and CSS components.',
  url: 'http://photonkit.com'
};

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Simple HTML syntax highlighter producing Pygments / Rouge classes
function highlightHtml(code) {
  // If this is plain directory tree or non-HTML code (e.g. photon/ ├── css/)
  if (!code.includes('<') && (code.includes('├──') || code.includes('│'))) {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="highlight"><pre><code class="language-html" data-lang="html">${escaped}</code></pre></div>`;
  }

  // Tokenize HTML
  const lines = code.split('\n');
  const highlightedLines = lines.map(line => {
    // Process HTML tokens using regex
    // Comments
    if (line.trim().startsWith('<!--')) {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="c">${escaped}</span>`;
    }
    // Doctype
    if (line.trim().startsWith('<!DOCTYPE') || line.trim().startsWith('<!doctype')) {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="cp">${escaped}</span>`;
    }

    // Tokenize tags and attributes
    // Match tags: (<\/?[a-zA-Z0-9\-]+)(.*?)(\/?>)
    let processed = line
      .replace(/&/g, '&amp;')
      .replace(/(<\/?[a-zA-Z0-9\-]+)(.*?)(\/?>)/g, (match, openTag, attrs, closeTag) => {
        const safeOpen = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeClose = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // Highlight attributes inside tag
        let highlightedAttrs = attrs;
        if (attrs) {
          highlightedAttrs = attrs.replace(/([a-zA-Z0-9\-:]+)(=)("[^"]*"|'[^']*'|[^\s>]+)/g, (m, attrName, eq, attrVal) => {
            return `<span class="na">${attrName}</span><span class="o">${eq}</span><span class="s">${attrVal}</span>`;
          });
        }
        return `<span class="nt">${safeOpen}</span>${highlightedAttrs}<span class="nt">${safeClose}</span>`;
      });

    return processed;
  });

  return `<div class="highlight"><pre><code class="language-html" data-lang="html">${highlightedLines.join('\n')}</code></pre></div>`;
}

function processContent(content, pageMeta, includes) {
  // Replace {% highlight html %} ... {% endhighlight %}
  let result = content.replace(/{%\s*highlight\s+(\w+)\s*%}([\s\S]*?){%\s*endhighlight\s*%}/g, (match, lang, code) => {
    return highlightHtml(code.trim());
  });

  // Replace {% include filename %}
  result = result.replace(/{%\s*include\s+([a-zA-Z0-9._\-]+)\s*%}/g, (match, includeName) => {
    if (includes[includeName]) {
      return includes[includeName];
    }
    const incPath = path.join(DOCS_SRC_DIR, '_includes', includeName);
    if (fs.existsSync(incPath)) {
      return fs.readFileSync(incPath, 'utf8');
    }
    return '';
  });

  // Replace Liquid variables: {{ page.title }}, {{ site.name }}, etc.
  result = result.replace(/{{\s*page\.title\s*}}/g, pageMeta.title || siteMeta.name);
  result = result.replace(/{{\s*site\.name\s*}}/g, siteMeta.name);
  result = result.replace(/{{\s*site\.description\s*}}/g, siteMeta.description);
  result = result.replace(/{{\s*site\.authors\s*}}/g, siteMeta.authors);
  result = result.replace(/{{\s*site\.url\s*}}/g, siteMeta.url);

  return result;
}

function parseFrontMatter(rawContent) {
  if (!rawContent.startsWith('---')) {
    return { meta: {}, body: rawContent };
  }
  const secondIndex = rawContent.indexOf('---', 3);
  if (secondIndex === -1) {
    return { meta: {}, body: rawContent };
  }
  const frontMatterText = rawContent.slice(3, secondIndex).trim();
  const body = rawContent.slice(secondIndex + 3).trim();

  const meta = {};
  for (const line of frontMatterText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body };
}

function compileDocs() {
  console.log(`Compiling ${path.basename(DOCS_SRC_DIR)}/ -> ${path.basename(OUTPUT_DIR)}/ ...`);

  // Ensure output directory exists
  if (OUTPUT_DIR !== DOCS_SRC_DIR) {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load layout
  const layoutPath = path.join(DOCS_SRC_DIR, '_layouts', 'default.html');
  const defaultLayout = fs.readFileSync(layoutPath, 'utf8');

  // Preload includes
  const includesDir = path.join(DOCS_SRC_DIR, '_includes');
  const includes = {};
  for (const file of fs.readdirSync(includesDir)) {
    includes[file] = fs.readFileSync(path.join(includesDir, file), 'utf8');
  }

  // 1. Copy static assets
  console.log('Copying static assets (assets/, dist/, components/)...');
  copyDirRecursive(path.join(DOCS_SRC_DIR, 'assets'), path.join(OUTPUT_DIR, 'assets'));
  copyDirRecursive(path.join(DOCS_SRC_DIR, 'dist'), path.join(OUTPUT_DIR, 'dist'));
  copyDirRecursive(path.join(DOCS_SRC_DIR, 'components'), path.join(OUTPUT_DIR, 'components'));

  // Copy root static files
  const demoAppSrc = path.join(DOCS_SRC_DIR, 'demo-app.html');
  if (fs.existsSync(demoAppSrc)) {
    fs.copyFileSync(demoAppSrc, path.join(OUTPUT_DIR, 'demo-app.html'));
  }
  const licenseSrc = path.join(DOCS_SRC_DIR, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(OUTPUT_DIR, 'LICENSE'));
  }
  const cnameSrc = path.join(ROOT_DIR, 'CNAME');
  if (fs.existsSync(cnameSrc)) {
    fs.copyFileSync(cnameSrc, path.join(OUTPUT_DIR, 'CNAME'));
  }

  // Add .nojekyll for GitHub Pages
  fs.writeFileSync(path.join(OUTPUT_DIR, '.nojekyll'), '', 'utf8');

  // 2. Render templates
  const pagesToRender = [
    { file: 'index.html', permalink: 'index.html' },
    { file: 'getting-started.html', permalink: 'getting-started' },
    { file: 'components.html', permalink: 'components' }
  ];

  for (const page of pagesToRender) {
    const rawPath = path.join(DOCS_SRC_DIR, page.file);
    const rawContent = fs.readFileSync(rawPath, 'utf8');
    const { meta, body } = parseFrontMatter(rawContent);

    // Process page body
    const processedBody = processContent(body, meta, includes);

    // Wrap in layout if specified
    let finalHtml = processedBody;
    if (meta.layout === 'default') {
      finalHtml = defaultLayout.replace('{{ content }}', processedBody);
      // Process layout includes and variables
      finalHtml = processContent(finalHtml, meta, includes);
    }

    if (page.permalink === 'index.html') {
      fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), finalHtml, 'utf8');
      console.log(`Rendered ${path.basename(OUTPUT_DIR)}/index.html`);
    } else {
      // Pretty permalinks: e.g. docs/components/index.html
      const dirPath = path.join(OUTPUT_DIR, page.permalink);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(path.join(dirPath, 'index.html'), finalHtml, 'utf8');
      // Also provide the .html file at root (e.g. docs/components.html) for compatibility
      fs.writeFileSync(path.join(OUTPUT_DIR, `${page.permalink}.html`), finalHtml, 'utf8');
      console.log(`Rendered ${path.basename(OUTPUT_DIR)}/${page.permalink}/index.html and ${path.basename(OUTPUT_DIR)}/${page.permalink}.html`);
    }
  }

  console.log(`\nDocs successfully compiled into ${path.basename(OUTPUT_DIR)}/ directory!`);
}

compileDocs();

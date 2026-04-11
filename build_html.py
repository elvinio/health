#!/usr/bin/env python3
"""Convert all fitness-kb markdown files into a single styled HTML page,
plus standalone him.html and her.html for the monthly plans."""

import re
import os
from html import unescape

# Use the system markdown (python 3.9 install)
import markdown
from markdown.extensions.tables import TableExtension
from markdown.extensions.toc import TocExtension

FILES = [
    ("Overview", "index.md"),
    ("Nutrition", "nutrition.md"),
    ("Supplements", "supplements.md"),
    ("Strength Training", "strength-training.md"),
    ("Cardio", "cardio.md"),
    ("Mobility & Prehab", "mobility-prehab.md"),
    ("Recovery", "recovery.md"),
    ("Hormones & Stress", "hormones-stress.md"),
    ("Grooming & Personal Care", "grooming-personal-care.md"),
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Section slugs for top-level TOC anchors ─────────────────────────────────
def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s]+', '-', text.strip())
    return text

# ── Parse headings from raw markdown ────────────────────────────────────────
def extract_headings(md_text):
    """Return list of (level, text, anchor) from markdown headings."""
    headings = []
    for line in md_text.split('\n'):
        m = re.match(r'^(#{1,4})\s+(.+)', line)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            # Remove inline markdown (bold, links, code)
            clean = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
            clean = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', clean)
            clean = re.sub(r'`(.+?)`', r'\1', clean)
            anchor = slugify(clean)
            headings.append((level, clean, anchor))
    return headings

# ── Convert markdown to HTML, injecting id anchors on headings ───────────────
def md_to_html(md_text, section_slug, base_url=""):
    """Convert markdown to HTML. Patch heading ids to be unique per section.
    Also rewrites internal anchor hrefs to use the prefixed ids."""
    seen = {}

    def make_unique_anchor(base):
        count = seen.get(base, 0)
        seen[base] = count + 1
        return base if count == 0 else f"{base}-{count}"

    md_obj = markdown.Markdown(
        extensions=[
            TableExtension(),
            'fenced_code',
            'nl2br',
            'sane_lists',
        ]
    )
    html = md_obj.convert(md_text)

    # 1. Build a mapping: old-slug → new-prefixed-slug
    #    We need two passes: first collect heading ids, then rewrite links.
    id_map = {}  # old_bare_slug → prefixed_uid
    seen2 = {}

    def make_uid2(base):
        count = seen2.get(base, 0)
        seen2[base] = count + 1
        return base if count == 0 else f"{base}-{count}"

    for m in re.finditer(r'<(h[1-4])>(.*?)</\1>', html, flags=re.DOTALL):
        content = m.group(2)
        clean = unescape(re.sub(r'<[^>]+>', '', content))
        bare = slugify(clean)
        uid = make_uid2(f"{section_slug}-{bare}")
        id_map[bare] = uid  # map bare slug → prefixed uid

    # 2. Add id attributes to headings using the same counters
    def add_id(m):
        tag = m.group(1)
        content = m.group(2)
        clean = unescape(re.sub(r'<[^>]+>', '', content))
        base = slugify(clean)
        uid = make_unique_anchor(f"{section_slug}-{base}")
        return f'<{tag} id="{uid}">{content}</{tag}>'

    html = re.sub(r'<(h[1-4])>(.*?)</\1>', add_id, html, flags=re.DOTALL)

    # 3. Rewrite internal anchor links: href="#old-bare" → href="#prefixed-uid"
    def fix_href(m):
        old_bare = m.group(1)
        # Try direct match, then try stripping leading digits (e.g. "1-creatine")
        if old_bare in id_map:
            return f'href="#{id_map[old_bare]}"'
        # Try prefixing with section slug directly
        prefixed = f"{section_slug}-{old_bare}"
        for uid in id_map.values():
            if uid == prefixed:
                return f'href="#{prefixed}"'
        # Strip leading number pattern like "1-" and retry
        stripped = re.sub(r'^\d+-', '', old_bare)
        if stripped in id_map:
            return f'href="#{id_map[stripped]}"'
        # Normalise multiple dashes (from "/" stripped as two spaces)
        normalised = re.sub(r'-{2,}', '-', old_bare)
        if normalised in id_map:
            return f'href="#{id_map[normalised]}"'
        # Give up — return unchanged
        return m.group(0)

    html = re.sub(r'href="#([^"]+)"', fix_href, html)

    # 4. Fix cross-file relative links like href="./supplements.md" → href="#supplements-top"
    def fix_file_link(m):
        href = m.group(1)
        fname = re.sub(r'^\./|\.md$', '', href)  # strip ./ and .md
        return f'href="{base_url}#{fname}-top"'

    html = re.sub(r'href="\./([^"]+\.md)"', fix_file_link, html)

    return html

# ── Build TOC data structure ─────────────────────────────────────────────────
def build_toc(all_sections):
    """all_sections: list of (section_slug, label, headings)
    headings: list of (level, text, anchor)
    Returns HTML string for the TOC panel."""
    lines = []
    for section_slug, label, headings in all_sections:
        # Section top-level link
        lines.append(f'<li class="toc-section"><a href="#{section_slug}-top">{label}</a><ul>')
        # Sub-headings (h2 and h3 only)
        for level, text, _ in headings:
            if level == 1:
                continue  # skip the document title
            # Recompute the real anchor (matching what md_to_html produces)
            # We reproduce the seen-counter logic per section
        # Redo with proper unique anchors
        seen = {}

        def make_uid(base):
            count = seen.get(base, 0)
            seen[base] = count + 1
            return base if count == 0 else f"{base}-{count}"

        for level, text, _ in headings:
            if level == 1:
                continue
            base = slugify(text)
            uid = make_uid(f"{section_slug}-{base}")
            indent_class = f"toc-h{level}"
            if level <= 3:
                lines.append(f'  <li class="{indent_class}"><a href="#{uid}">{text}</a></li>')
        lines.append('</ul></li>')
    return '\n'.join(lines)

# ── HTML template ─────────────────────────────────────────────────────────────
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#8b5e3c">
<title>{title}</title>
<style>
  /* ── Reset ────────────────────────────────────────────── */
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  :root {{
    --bg:        #faf6ee;
    --paper:     #fdf9f2;
    --text:      #2c2416;
    --muted:     #7a6a52;
    --accent:    #8b5e3c;
    --accent2:   #5a7c5e;
    --border:    #e5dcc8;
    --toc-bg:    #f4ede0;
    --toc-w:     285px;
    --fab-size:  3.25rem;
    --serif:     'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
    --sans:      -apple-system, 'Helvetica Neue', Arial, sans-serif;
    --mono:      'Courier New', Courier, monospace;
    --safe-b:    env(safe-area-inset-bottom, 0px);
    --safe-r:    env(safe-area-inset-right, 0px);
  }}

  html {{
    font-size: 18px;
    scroll-behavior: smooth;
    /* Prevent text size bump in landscape on iOS */
    -webkit-text-size-adjust: 100%;
  }}

  body {{
    background: var(--bg);
    color: var(--text);
    font-family: var(--serif);
    line-height: 1.85;
    display: flex;
    min-height: 100vh;
  }}

  /* ════════════════════════════════════════════════════════
     TOC SIDEBAR
  ════════════════════════════════════════════════════════ */
  #toc-sidebar {{
    position: fixed;
    top: 0; left: 0;
    width: var(--toc-w);
    height: 100%;
    height: 100dvh;
    background: var(--toc-bg);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding: 1.4rem 0 5rem;
    z-index: 300;
    /* Desktop: always visible */
  }}

  /* TOC header row with close button */
  .toc-header {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.6rem;
  }}

  .toc-header h2 {{
    font-family: var(--sans);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }}

  /* Close button — hidden on desktop */
  #toc-close {{
    display: none;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--muted);
    font-size: 1.35rem;
    line-height: 1;
    padding: 0.25rem 0.35rem;
    border-radius: 6px;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }}

  #toc-close:active {{ background: rgba(0,0,0,0.08); }}

  #toc-sidebar ul {{ list-style: none; padding: 0; }}

  #toc-sidebar li.toc-section {{ margin-top: 0.1rem; }}

  #toc-sidebar li.toc-section > a {{
    display: block;
    padding: 0.5rem 1.25rem;
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    font-family: var(--sans);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
    letter-spacing: 0.02em;
    border-left: 3px solid transparent;
    transition: border-color 0.15s, background 0.15s;
    -webkit-tap-highlight-color: transparent;
  }}

  #toc-sidebar li.toc-section > a:hover,
  #toc-sidebar li.toc-section > a:active {{
    background: rgba(139,94,60,0.08);
    border-left-color: var(--accent);
  }}

  #toc-sidebar li.toc-section > ul {{
    padding-left: 0;
    margin: 0 0 0.4rem;
  }}

  #toc-sidebar .toc-h2 > a {{
    display: flex;
    align-items: center;
    min-height: 2.5rem;
    padding: 0.3rem 1.25rem 0.3rem 1.75rem;
    font-family: var(--sans);
    font-size: 0.72rem;
    color: #5a4e3a;
    text-decoration: none;
    border-left: 3px solid transparent;
    transition: border-color 0.15s, background 0.15s;
    line-height: 1.4;
    -webkit-tap-highlight-color: transparent;
  }}

  #toc-sidebar .toc-h2 > a:hover,
  #toc-sidebar .toc-h2 > a:active {{
    background: rgba(139,94,60,0.05);
    border-left-color: var(--border);
    color: var(--accent);
  }}

  #toc-sidebar .toc-h3 > a {{
    display: flex;
    align-items: center;
    min-height: 2.25rem;
    padding: 0.2rem 1.25rem 0.2rem 2.5rem;
    font-family: var(--sans);
    font-size: 0.66rem;
    color: var(--muted);
    text-decoration: none;
    line-height: 1.35;
    -webkit-tap-highlight-color: transparent;
  }}

  #toc-sidebar .toc-h3 > a:hover,
  #toc-sidebar .toc-h3 > a:active {{ color: var(--accent); }}

  /* Active TOC link */
  #toc-sidebar a.active {{
    color: var(--accent) !important;
    font-weight: 700 !important;
    border-left-color: var(--accent) !important;
    background: rgba(139,94,60,0.1) !important;
  }}

  /* ════════════════════════════════════════════════════════
     BACKDROP (mobile overlay behind open sidebar)
  ════════════════════════════════════════════════════════ */
  #toc-backdrop {{
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(30, 20, 10, 0.45);
    z-index: 290;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    opacity: 0;
    pointer-events: none;           /* invisible backdrop must NOT intercept touches */
    transition: opacity 0.25s ease;
  }}

  #toc-backdrop.visible {{
    opacity: 1;
    pointer-events: auto;           /* only intercept touches when actually visible */
  }}

  /* ════════════════════════════════════════════════════════
     MAIN CONTENT
  ════════════════════════════════════════════════════════ */
  #main {{
    margin-left: var(--toc-w);
    flex: 1;
    max-width: 860px;
    padding: 4rem 3rem 7rem 4rem;
    min-width: 0; /* prevent flex overflow */
  }}

  /* ── Section wrappers ─────────────────────────────────── */
  .kb-section {{
    margin-bottom: 5rem;
    border-top: 2px solid var(--border);
    padding-top: 3rem;
  }}

  .kb-section:first-child {{
    border-top: none;
    padding-top: 0;
  }}

  /* ── Typography ───────────────────────────────────────── */
  h1 {{
    font-size: 2.05rem;
    line-height: 1.25;
    color: var(--accent);
    margin-bottom: 0.5rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }}

  h2 {{
    font-size: 1.5rem;
    margin-top: 3rem;
    margin-bottom: 0.65rem;
    color: var(--text);
    line-height: 1.3;
    font-weight: 700;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3rem;
  }}

  h3 {{
    font-size: 1.18rem;
    margin-top: 2.2rem;
    margin-bottom: 0.5rem;
    color: #3d2f1e;
    font-weight: 700;
    line-height: 1.35;
  }}

  h4 {{
    font-size: 1rem;
    margin-top: 1.6rem;
    margin-bottom: 0.4rem;
    color: var(--muted);
    font-weight: 700;
    font-style: italic;
  }}

  p {{
    margin-bottom: 1.1rem;
    text-align: justify;
    hyphens: auto;
  }}

  h2 + p, h3 + p, h4 + p {{ margin-top: 0; }}

  a {{ color: var(--accent2); text-decoration: underline; text-underline-offset: 2px; }}
  a:hover {{ color: var(--accent); }}
  strong {{ color: #2c1f0e; }}
  em {{ font-style: italic; color: #4a3a28; }}

  /* ── Lists ────────────────────────────────────────────── */
  ul, ol {{ padding-left: 1.6rem; margin-bottom: 1.1rem; }}
  li {{ margin-bottom: 0.35rem; line-height: 1.75; }}
  li > ul, li > ol {{ margin-top: 0.25rem; margin-bottom: 0.25rem; }}

  /* ── Blockquotes ──────────────────────────────────────── */
  blockquote {{
    border-left: 4px solid var(--accent);
    background: #f5ede0;
    margin: 1.5rem 0;
    padding: 0.85rem 1.2rem;
    border-radius: 0 6px 6px 0;
    font-size: 0.97rem;
    color: #3d2b1a;
  }}
  blockquote p:last-child {{ margin-bottom: 0; }}
  blockquote strong {{ color: var(--accent); }}

  /* ── Tables — wrapped for horizontal scroll on mobile ─── */
  .table-wrap {{
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 1.5rem 0 2rem;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }}

  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    font-family: var(--sans);
    background: var(--paper);
    min-width: 480px; /* scroll below this width */
  }}

  thead {{ background: #e8dcc8; }}

  th {{
    padding: 0.65rem 0.9rem;
    text-align: left;
    font-weight: 700;
    color: #3d2b1a;
    border-bottom: 2px solid var(--border);
    white-space: nowrap;
  }}

  td {{
    padding: 0.55rem 0.9rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
    line-height: 1.55;
    color: #2c2416;
  }}

  tr:last-child td {{ border-bottom: none; }}
  tr:nth-child(even) td {{ background: rgba(0,0,0,0.018); }}

  /* ── Code ─────────────────────────────────────────────── */
  code {{
    font-family: var(--mono);
    font-size: 0.83em;
    background: #ede5d6;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    color: #5a3520;
  }}

  pre {{
    background: #2c2416;
    color: #f0e8d8;
    padding: 1.2rem 1.5rem;
    border-radius: 6px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    font-size: 0.82rem;
    margin: 1.5rem 0;
    line-height: 1.6;
  }}

  pre code {{ background: none; padding: 0; color: inherit; font-size: inherit; }}

  hr {{ border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }}

  /* ── Section label ────────────────────────────────────── */
  .section-label {{
    font-family: var(--sans);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.65rem;
    display: block;
  }}

  /* ════════════════════════════════════════════════════════
     FAB — floating action button (Contents)
     Hidden on desktop; shown on mobile
  ════════════════════════════════════════════════════════ */
  #fab {{
    display: none; /* shown via media query */
    position: fixed;
    bottom: calc(1.5rem + var(--safe-b));
    right: calc(1.25rem + var(--safe-r));
    z-index: 310;                   /* above sidebar (300) and backdrop (290) */
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 2rem;
    height: var(--fab-size);
    padding: 0 1.1rem;
    gap: 0.5rem;
    font-family: var(--sans);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    align-items: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.28), 0 1px 4px rgba(0,0,0,0.15);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }}

  #fab:active {{
    transform: scale(0.94);
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }}

  #fab svg {{
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
  }}

  /* ════════════════════════════════════════════════════════
     RESPONSIVE BREAKPOINTS
  ════════════════════════════════════════════════════════ */

  /* Narrow desktop / large tablet */
  @media (max-width: 1000px) {{
    :root {{ --toc-w: 250px; }}
    #main {{ padding: 3rem 2rem 6rem 2.5rem; max-width: none; }}
  }}

  /* Mobile — sidebar becomes an overlay drawer */
  @media (max-width: 700px) {{
    /* Sidebar hidden off-screen by default */
    #toc-sidebar {{
      transform: translateX(-105%);
      transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
                  box-shadow 0.28s ease;
      box-shadow: none;
      width: min(var(--toc-w), 88vw);
    }}

    /* Open state */
    #toc-sidebar.open {{
      transform: translateX(0);
      box-shadow: 6px 0 24px rgba(0,0,0,0.18);
    }}

    /* Show close button & backdrop */
    #toc-close {{ display: block; }}
    #toc-backdrop {{ display: block; }}

    /* Main takes full width */
    #main {{
      margin-left: 0;
      padding: 1.6rem 1.1rem calc(5rem + var(--safe-b)) 1.1rem;
      max-width: none;
    }}

    /* Show FAB */
    #fab {{ display: flex; }}

    /* Typography scale */
    html {{ font-size: 17px; }}
    h1 {{ font-size: 1.65rem; }}
    h2 {{ font-size: 1.3rem; margin-top: 2.2rem; }}
    h3 {{ font-size: 1.1rem; margin-top: 1.8rem; }}

    /* Left-align body text on narrow screens */
    p {{ text-align: left; hyphens: none; }}

    /* Blockquotes slightly tighter */
    blockquote {{ padding: 0.7rem 1rem; font-size: 0.93rem; }}
  }}

  /* Very small phones */
  @media (max-width: 380px) {{
    html {{ font-size: 16px; }}
    #main {{ padding-left: 0.9rem; padding-right: 0.9rem; }}
  }}
</style>
</head>
<body>

<!-- ── Backdrop ──────────────────────────────────────────────────────────── -->
<div id="toc-backdrop" aria-hidden="true"></div>

<!-- ── TOC Sidebar ──────────────────────────────────────────────────────── -->
<nav id="toc-sidebar" aria-label="Table of contents">
  <div class="toc-header">
    <h2>Contents</h2>
    <button id="toc-close" aria-label="Close contents">&#x2715;</button>
  </div>
  <ul>
{toc_html}
  </ul>
</nav>

<!-- ── Main ─────────────────────────────────────────────────────────────── -->
<main id="main">
{sections_html}
</main>

<!-- ── FAB ───────────────────────────────────────────────────────────────── -->
<button id="fab" aria-label="Open table of contents">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="3" y1="6"  x2="21" y2="6"/>
    <line x1="3" y1="12" x2="16" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
  Contents
</button>

<script>
(function () {{
  const sidebar  = document.getElementById('toc-sidebar');
  const backdrop = document.getElementById('toc-backdrop');
  const fab      = document.getElementById('fab');
  const closeBtn = document.getElementById('toc-close');

  function openTOC() {{
    sidebar.classList.add('open');
    backdrop.classList.add('visible');
    fab.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; // prevent background scroll
  }}

  function closeTOC() {{
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
    fab.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }}

  fab.addEventListener('click', openTOC);
  closeBtn.addEventListener('click', closeTOC);
  backdrop.addEventListener('click', closeTOC);

  // Close sidebar when a TOC link is tapped (mobile)
  sidebar.querySelectorAll('a').forEach(function(link) {{
    link.addEventListener('click', function() {{
      if (window.innerWidth <= 700) closeTOC();
    }});
  }});

  // Escape key closes
  document.addEventListener('keydown', function(e) {{
    if (e.key === 'Escape') closeTOC();
  }});

  // ── Wrap all tables for horizontal scroll ──
  document.querySelectorAll('#main table').forEach(function(t) {{
    if (t.parentNode.classList.contains('table-wrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  }});

  // ── Highlight active TOC link on scroll ──
  var headings = Array.from(document.querySelectorAll('#main h1,#main h2,#main h3,#main h4'))
                      .filter(function(h) {{ return h.id; }});

  function getActiveHeading() {{
    var scrollY = window.scrollY + window.innerHeight * 0.18;
    var active = headings[0];
    for (var i = 0; i < headings.length; i++) {{
      if (headings[i].getBoundingClientRect().top + window.scrollY <= scrollY) {{
        active = headings[i];
      }} else {{
        break;
      }}
    }}
    return active;
  }}

  var lastActive = null;
  function updateActive() {{
    var h = getActiveHeading();
    if (!h || h === lastActive) return;
    lastActive = h;
    var allLinks = sidebar.querySelectorAll('a');
    allLinks.forEach(function(l) {{ l.classList.remove('active'); }});
    var link = sidebar.querySelector('a[href="#' + h.id + '"]');
    if (link) {{
      link.classList.add('active');
      // Scroll the TOC to show the active link (desktop always-visible sidebar)
      link.scrollIntoView({{ block: 'nearest', behavior: 'smooth' }});
    }}
  }}

  var ticking = false;
  window.addEventListener('scroll', function() {{
    if (!ticking) {{
      requestAnimationFrame(function() {{ updateActive(); ticking = false; }});
      ticking = true;
    }}
  }}, {{ passive: true }});

  updateActive(); // run once on load
}})();
</script>

</body>
</html>
"""

# ── Standalone plan page builder ──────────────────────────────────────────────
def build_plan_page(label, filename, out_filename):
    """Build a standalone HTML page for a single markdown file."""
    path = os.path.join(BASE_DIR, filename)
    with open(path, 'r', encoding='utf-8') as f:
        md_text = f.read()

    slug = slugify(label)
    headings = extract_headings(md_text)
    all_sections = [(slug, label, headings)]

    body_html = md_to_html(md_text, slug, base_url="./")
    section_html = f'<section class="kb-section" id="{slug}-top">\n<span class="section-label">{label}</span>\n{body_html}\n</section>'

    toc_html = build_toc(all_sections)
    back_link = '<p style="margin-bottom:2rem"><a href="./" style="font-family:var(--sans);font-size:0.85rem">&#8592; Back to Knowledgebase</a></p>'
    sections_html = back_link + '\n\n' + section_html

    output = HTML_TEMPLATE.format(
        title=f"{label} — Singapore 40–50",
        toc_html=toc_html,
        sections_html=sections_html,
    )

    out_path = os.path.join(BASE_DIR, out_filename)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(output)

    size_kb = os.path.getsize(out_path) // 1024
    print(f"Written: {out_path} ({size_kb} KB)")


# ── Main builder ──────────────────────────────────────────────────────────────
def build():
    all_sections = []  # (slug, label, headings_list)
    section_htmls = []

    for label, filename in FILES:
        path = os.path.join(BASE_DIR, filename)
        with open(path, 'r', encoding='utf-8') as f:
            md_text = f.read()

        slug = slugify(label)
        headings = extract_headings(md_text)
        all_sections.append((slug, label, headings))

        body_html = md_to_html(md_text, slug)

        section_html = f'''<section class="kb-section" id="{slug}-top">
<span class="section-label">{label}</span>
{body_html}
</section>'''
        section_htmls.append(section_html)

    toc_html = build_toc(all_sections)
    sections_html = '\n\n'.join(section_htmls)

    output = HTML_TEMPLATE.format(
        title="Fitness &amp; Nutrition Knowledgebase — Singapore 40–50",
        toc_html=toc_html,
        sections_html=sections_html,
    )

    out_path = os.path.join(BASE_DIR, 'index.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(output)

    size_kb = os.path.getsize(out_path) // 1024
    print(f"Written: {out_path} ({size_kb} KB)")

    build_plan_page("Monthly Plan \u2014 Male",   "monthly-plan-male.md",   "him.html")
    build_plan_page("Monthly Plan \u2014 Female", "monthly-plan-female.md", "her.html")

if __name__ == '__main__':
    build()

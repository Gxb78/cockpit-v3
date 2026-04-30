#!/usr/bin/env python3
"""
Scan 35 CSS split files for dead CSS classes — defined but never used in HTML or JS.
"""
import os, re, sys

BASE = "/mnt/c/Users/gb781/Desktop/Journal"
CSS_DIR = os.path.join(BASE, "static/css/split")
HTML_DIR = os.path.join(BASE, "templates")
JS_DIR = os.path.join(BASE, "static/js/split")

# Gather all CSS split files
css_files = sorted([
    os.path.join(CSS_DIR, f) for f in sorted(os.listdir(CSS_DIR))
    if f.endswith(".css")
])

print(f"Found {len(css_files)} CSS split files", file=sys.stderr)

# Gather all HTML and JS content for search
all_search_text = ""

# HTML files
for root, dirs, files in os.walk(HTML_DIR):
    for f in files:
        if f.endswith(".html"):
            fp = os.path.join(root, f)
            with open(fp, "r", encoding="utf-8") as fh:
                all_search_text += fh.read() + "\n"

# JS split files
for f in sorted(os.listdir(JS_DIR)):
    if f.endswith(".js"):
        fp = os.path.join(JS_DIR, f)
        with open(fp, "r", encoding="utf-8") as fh:
            all_search_text += fh.read() + "\n"

# Also check main JS files
main_js = os.path.join(BASE, "static/app.js")
if os.path.exists(main_js):
    with open(main_js, "r", encoding="utf-8") as fh:
        all_search_text += fh.read() + "\n"

main_css = os.path.join(BASE, "static/style.css")
if os.path.exists(main_css):
    with open(main_css, "r", encoding="utf-8") as fh:
        all_search_text += fh.read() + "\n"

print(f"Search corpus size: {len(all_search_text)} chars", file=sys.stderr)

# Classes to exclude (generic utility classes)
EXCLUDE_CLASSES = {
    ".hidden", ".active", ".mono", ".disabled", ".visible", ".selected",
    ".loading", ".error", ".success", ".warning", ".info", ".empty",
    ".focus", ".hover", ".checked", ".expanded", ".collapsed",
    ".open", ".closed", ".done", ".pending", ".inactive",
    ".flex", ".grid", ".row", ".col", ".container",
    ".text-center", ".text-left", ".text-right", ".text-muted",
    ".text-bold", ".text-small", ".text-large",
    ".block-body", ".block-row",
}

# Pseudo suffixes to skip in selectors
PSEUDO_SUFFIXES = [
    ':hover', ':focus', ':active', ':visited', ':focus-visible',
    ':focus-within', ':first-child', ':last-child', ':nth-child',
    ':nth-of-type', ':first-of-type', ':last-of-type',
    ':before', ':after', ':not', ':is', ':where', ':has',
    ':disabled', ':enabled', ':checked', ':required', ':optional',
    ':read-only', ':read-write', ':empty', ':target',
    ':link', ':any-link', ':only-child', ':only-of-type',
    ':scope', ':root', ':defined', ':host', ':host-context',
    ':lang', ':dir', ':placeholder-shown', ':default',
    ':in-range', ':out-of-range', ':valid', ':invalid',
    ':user-valid', ':user-invalid', ':indeterminate',
    '::before', '::after', '::first-line', '::first-letter',
    '::selection', '::placeholder', '::marker', '::backdrop',
    '::slotted', '::part', '::file-selector-button',
]

def is_pseudo_class(cls):
    return any(p in cls for p in PSEUDO_SUFFIXES)

# Extract all selectors from each CSS file with line numbers
results = {}

for css_path in css_files:
    filename = os.path.basename(css_path)
    with open(css_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    selector_accum = ""
    
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        
        # Skip empty lines, comments, @ rules that aren't selectors
        if not stripped or stripped.startswith('/*') or stripped.startswith('*'):
            continue
        
        # Remove inline comments
        clean = re.sub(r'/\*.*?\*/', '', stripped)
        
        if '{' in clean:
            # Extract selector part (text before first {)
            sel_part = clean.split('{')[0].strip()
            
            full_sel = sel_part
            if selector_accum:
                full_sel = (selector_accum + ' ' + sel_part).strip()
            selector_accum = ""
            
            # Extract classes from this selector block
            # Split by comma for multiple selectors
            individual_selectors = [s.strip() for s in re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', full_sel)]
            
            for ind_sel in individual_selectors:
                classes = re.findall(r'\.[a-zA-Z0-9_-]+', ind_sel)
                ids = re.findall(r'\#[a-zA-Z0-9_-]+', ind_sel)
                
                for cls in classes:
                    if is_pseudo_class(cls):
                        continue
                    if cls in EXCLUDE_CLASSES:
                        continue
                    # Skip CSS variable classes like .--foo
                    if cls.startswith('.--') or '--' in cls[1:]:
                        continue
                    
                    key = f"{filename}:{lineno}"
                    if cls not in results:
                        results[cls] = []
                    results[cls].append(key)
                
                for id_ in ids:
                    rid = id_.split(':')[0].split('::')[0]
                    if rid != id_:
                        continue
                    key = f"{filename}:{lineno}"
                    if rid not in results:
                        results[rid] = []
                    results[rid].append(key)
        
        elif '}' in clean:
            selector_accum = ""
        
        elif not clean.startswith('@') and clean:
            # Could be continuation of a multi-line selector
            selector_accum = clean
        else:
            selector_accum = ""

# For each class, check if it appears in the search text
dead_classes = []

# Build set of all bare names used in HTML/JS
# Extract class="..." values
used_in_html = set()
for m in re.finditer(r'class\s*=\s*["\']([^"\']+)["\']', all_search_text):
    for c in m.group(1).split():
        c = c.strip()
        if c:
            used_in_html.add(c)

# Extract className="..."
for m in re.finditer(r'className\s*=\s*["\']([^"\']+)["\']', all_search_text):
    for c in m.group(1).split():
        c = c.strip()
        if c:
            used_in_html.add(c)

# Extract classList.add/remove/toggle/contains("class")
for m in re.finditer(r'classList\.(?:add|remove|toggle|contains)\s*\(\s*["\']([^"\']+)["\']', all_search_text):
    c = m.group(1).strip()
    if c:
        used_in_html.add(c)

# Also grab from backtick template literals
for m in re.finditer(r'classList\.(?:add|remove|toggle|contains)\s*\(\s*`([^`]+)`', all_search_text):
    c = m.group(1).strip()
    if c:
        used_in_html.add(c)

# querySelector(".class")
for m in re.finditer(r'querySelector(?:All)?\s*\(\s*["\'][.#]?([a-zA-Z0-9_-]+)', all_search_text):
    c = m.group(1).strip()
    if c:
        used_in_html.add(c)

# querySelector with concatenation or style binding
# Check for literal appearance with a dot prefix in HTML attributes (like hx-class)
for m in re.finditer(r'hx-class\s*=\s*["\']([^"\']+)["\']', all_search_text):
    for c in m.group(1).split():
        c = c.strip()
        if c:
            used_in_html.add(c)

print(f"Unique class names found in HTML/JS: {len(used_in_html)}", file=sys.stderr)

for cls_name, locations in sorted(results.items()):
    bare_name = cls_name.lstrip('.') if cls_name.startswith('.') else cls_name.lstrip('#')
    
    found = False
    
    # Direct lookup in used_in_html set
    if bare_name in used_in_html:
        found = True
    
    # Also check for class="bare_name" with surrounding spaces/quotes
    if not found:
        patterns = [
            f'class="{bare_name}"',
            f"class='{bare_name}'",
            f'class="{bare_name} ',
            f"class='{bare_name} ",
            f'class="...{bare_name}"',
            f'class="...{bare_name} ',
            f' "{bare_name}"',
            f" '{bare_name}'",
            f'classList.add("{bare_name}"',
            f"classList.add('{bare_name}'",
            f'classList.add(`{bare_name}`',
            f'classList.remove("{bare_name}"',
            f"classList.remove('{bare_name}'",
            f'classList.toggle("{bare_name}"',
            f"classList.toggle('{bare_name}'",
            f'.{bare_name}"',  # .classname" at end of attribute
            f".{bare_name}'",
            f'.{bare_name} ',  # .classname followed by space
            f'.{bare_name}"',  # .classname" 
            f'.{bare_name}\\',  # in JS strings
            f'`.{bare_name}`',
            f'".{bare_name}"',
            f"'.{bare_name}'",
        ]
        for p in patterns:
            if p in all_search_text:
                found = True
                break
    
    # Fuzzy: check if bare_name appears as a word anywhere
    if not found:
        if re.search(r'(?<![a-zA-Z0-9_-])' + re.escape(bare_name) + r'(?![a-zA-Z0-9_-])', all_search_text):
            # But only if it's not just a substring of a longer identifier
            found = True
    
    if not found:
        for loc in locations:
            dead_classes.append(f"{loc} — {cls_name}")

# Output
for entry in dead_classes:
    print(entry)

print(f"\nTotal: {len(dead_classes)} unused selectors found", file=sys.stderr)
print(f"Total CSS selectors extracted: {len(results)}", file=sys.stderr)

#!/usr/bin/env python3
"""
Dead CSS Scanner
Extracts CSS selectors from each split CSS file and checks if they appear
in HTML templates (templates/) or JS files (static/js/split/).
Reports files whose selectors are completely orphaned.
"""

import os
import re
import sys

PROJECT = "/mnt/c/Users/gb781/Desktop/Journal"
CSS_DIR = os.path.join(PROJECT, "static/css/split")
TEMPLATE_DIRS = [
    os.path.join(PROJECT, "templates"),
]
JS_DIRS = [
    os.path.join(PROJECT, "static/js/split"),
]

# Excluded selectors (universal, pseudo, tag selectors that aren't meaningful to search)
SKIP_SELECTORS = {"*", "html", "body", "head", ":root", "::selection", ":focus-visible"}


def extract_selectors_from_css(css_content):
    """Extract meaningful CSS selectors (classes, IDs, attributes) from a CSS file content."""
    selectors = set()
    
    # Remove comments
    text = re.sub(r'/\*.*?\*/', '', css_content, flags=re.DOTALL)
    
    # Split by opening brace to get rule blocks
    # A rule is everything before { 
    blocks = re.split(r'\{', text)
    
    for block in blocks[:-1]:  # last block has no { after it
        # Get the selector part (last line before {)
        lines = block.strip().split('\n')
        if not lines:
            continue
        selector_part = lines[-1].strip()
        
        # Handle multi-selectors (comma separated)
        for sel in selector_part.split(','):
            sel = sel.strip()
            if not sel:
                continue
            
            # Extract classes
            classes = re.findall(r'\.([a-zA-Z0-9_-]+)', sel)
            for cls in classes:
                selectors.add(f'.{cls}')
                selectors.add(cls)  # also without dot for broader search
            
            # Extract IDs
            ids = re.findall(r'#([a-zA-Z0-9_-]+)', sel)
            for id_ in ids:
                selectors.add(f'#{id_}')
                selectors.add(id_)
            
            # Extract attribute selectors like [data-x], [type=text]
            attrs = re.findall(r'\[([a-zA-Z_-]+)', sel)
            for attr in attrs:
                selectors.add(f'[{attr}]')
                selectors.add(attr)
    
    # Remove universal/pseudo-only selectors
    selectors = {s for s in selectors if s not in SKIP_SELECTORS and len(s) > 1}
    
    return selectors


def search_in_files(selectors, file_paths):
    """Check which selectors exist in the given file paths. Returns set of found selectors."""
    found = set()
    
    for filepath in file_paths:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
        except Exception as e:
            print(f"  [WARN] Cannot read {filepath}: {e}", file=sys.stderr)
            continue
        
        relpath = os.path.relpath(filepath, PROJECT)
        for sel in selectors:
            # Search for the selector as a word boundary match
            # For classes: class="xxx" or class='xxx' or class="xxx yyy" or .xxx
            # For IDs: id="xxx" or id='xxx' or #xxx
            # For data attributes: data-xxx or [data-xxx]
            
            if sel.startswith('.'):
                # Class selector - search for class="cls" or class='cls' or .cls or {{ "cls" }}
                cls_name = sel[1:]
                # Search patterns for classes
                if re.search(rf'class="[^"]*\b{re.escape(cls_name)}\b[^"]*"', content) or \
                   re.search(rf"class='[^']*\b{re.escape(cls_name)}\b[^']*'", content) or \
                   re.search(rf'className="[^"]*\b{re.escape(cls_name)}\b[^"]*"', content) or \
                   re.search(rf"\b{re.escape(cls_name)}\b", content):
                    found.add(sel)
                    
            elif sel.startswith('#'):
                # ID selector - search for id="xxx" or id='xxx'
                id_name = sel[1:]
                if re.search(rf'id="\s*{re.escape(id_name)}\s*"', content) or \
                   re.search(rf"id='\s*{re.escape(id_name)}\s*'", content) or \
                   re.search(rf'#{re.escape(id_name)}\b', content):
                    found.add(sel)
                    
            elif sel.startswith('[') and sel.endswith(']'):
                # Attribute presence selector like [data-x]
                attr_name = sel[1:-1]
                if re.search(rf'\b{re.escape(attr_name)}\b', content):
                    found.add(sel)
            else:
                # Plain selector (could be class name, id name, or data attr)
                if re.search(rf'\b{re.escape(sel)}\b', content):
                    found.add(sel)
    
    return found


def collect_all_files():
    """Collect all template and JS file paths."""
    files = []
    
    for d in TEMPLATE_DIRS:
        for root, dirs, fnames in os.walk(d):
            for f in fnames:
                if f.endswith('.html'):
                    files.append(os.path.join(root, f))
    
    for d in JS_DIRS:
        for root, dirs, fnames in os.walk(d):
            for f in fnames:
                if f.endswith('.js'):
                    files.append(os.path.join(root, f))
    
    return files


def main():
    css_files = sorted(os.listdir(CSS_DIR))
    all_source_files = collect_all_files()
    
    print(f"📁 {len(css_files)} CSS files to analyze")
    print(f"📄 {len(all_source_files)} HTML/JS files to search in")
    print()
    
    results = []
    
    for css_file in css_files:
        if not css_file.endswith('.css'):
            continue
        
        css_path = os.path.join(CSS_DIR, css_file)
        
        with open(css_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        selectors = extract_selectors_from_css(content)
        
        if not selectors:
            print(f"  ⚠  {css_file}: no extractable class/ID selectors (pseudo-only)")
            continue
        
        found = search_in_files(selectors, all_source_files)
        
        missing = selectors - found
        
        # Filter out very generic short tokens that cause false positives
        # Like "grid", "bar", "md", "sm", "lg", "xs", etc.
        GENERIC_TOKENS = {
            "box", "grid", "bar", "tab", "card", "row", "col", "item",
            "header", "footer", "body", "title", "text", "icon",
            "left", "right", "top", "bottom", "center", "middle",
            "sm", "md", "lg", "xl", "xs", "xxs", "xxl",
            "in", "out", "up", "down", "on", "off",
            "active", "hover", "focus", "disabled", "selected",
            "small", "large", "mini", "full", "half",
            "light", "dark", "primary", "secondary", "info",
            "success", "warning", "danger", "error",
            "hidden", "visible", "show", "hide",
            "first", "last", "prev", "next",
            "start", "end", "before", "after",
            "open", "close", "min", "max",
            "container", "wrapper", "inner", "outer",
            "group", "section", "block", "list",
            "link", "btn", "button", "input",
            "label", "value", "key", "data",
            "step", "slide", "page", "panel",
            "overlay", "backdrop", "dialog", "popup",
            "tooltip", "dropdown", "menu", "submenu",
            "badge", "pill", "chip", "tag",
            "metric", "kpi", "stat", "chart",
            "legend", "axis", "tick", "gridline",
            "slot", "zone", "area", "region",
        }
        
        # Only report if meaningful selectors are missing
        meaningful_missing = {s for s in missing 
                              if s not in GENERIC_TOKENS 
                              and s.lstrip('.') not in GENERIC_TOKENS 
                              and s.lstrip('#') not in GENERIC_TOKENS}
        
        # Check the ratio of missing vs total
        total_meaningful = {s for s in selectors 
                           if s not in GENERIC_TOKENS 
                           and s.lstrip('.') not in GENERIC_TOKENS
                           and s.lstrip('#') not in GENERIC_TOKENS}
        
        if len(meaningful_missing) > 0:
            pct = len(meaningful_missing) / len(total_meaningful) * 100 if total_meaningful else 0
            results.append((css_file, len(selectors), len(meaningful_missing), pct, missing, found))
            
            if pct >= 80:
                status = "🔴 SUSPECT (orphaned)"
            elif pct >= 50:
                status = "🟡 PARTIAL"
            elif pct >= 30:
                status = "🔵 WARN"
            else:
                status = "⚪ MINOR"
            
            # Show only meaningful missing
            if meaningful_missing:
                print(f"  {status} {css_file}")
                print(f"       Total selectors: {len(selectors)}, Missing: {len(meaningful_missing)}/{len(total_meaningful)} ({pct:.0f}%)")
                print(f"       Unreferenced: {', '.join(sorted(meaningful_missing))}")
                print()
    
    # Summary
    print("=" * 70)
    print("📊 SUMMARY")
    print("=" * 70)
    print()
    
    orphans = [r for r in results if r[3] >= 80]
    partials = [r for r in results if 50 <= r[3] < 80]
    
    if orphans:
        print(f"🔴 SUSPECT (≥80% selectors orphaned) — {len(orphans)} files:")
        for css_file, total, missing_count, pct, missing, found in orphans:
            meaningful_missing = {s for s in missing 
                                  if s.lstrip('.') not in {"box","grid","bar","tab","card","row","col","item",
                                      "header","footer","body","title","text","icon",
                                      "left","right","top","bottom","center","middle",
                                      "sm","md","lg","xl","xs","active","hover","focus",
                                      "disabled","selected","hidden","visible","show","hide",
                                      "container","wrapper","inner","outer","group","section",
                                      "block","list","link","btn","button","input",
                                      "label","value","step","slide","page","panel",
                                      "overlay","backdrop","dialog","popup",
                                      "tooltip","dropdown","menu","submenu",
                                      "badge","pill","chip","tag",
                                      "metric","kpi","stat","chart",
                                      "legend","axis","tick","gridline",
                                      "slot","zone","area","region"}}
            print(f"  {css_file} — {missing_count}/{total} selectors orphaned ({pct:.0f}%)")
            print(f"    Unreferenced: {', '.join(sorted(meaningful_missing))}")
        print()
    
    if partials:
        print(f"🟡 PARTIAL (50-79% orphaned) — {len(partials)} files:")
        for css_file, total, missing_count, pct, missing, found in partials:
            meaningful_missing = {s for s in missing 
                                  if s.lstrip('.') not in GENERIC_TOKENS}
            print(f"  {css_file} — {missing_count}/{total} selectors orphaned ({pct:.0f}%)")
            print(f"    Unreferenced: {', '.join(sorted(meaningful_missing))}")
        print()
    
    total_suspect = len(orphans) + len(partials)
    print(f"Total files analyzed: {len(css_files)}")
    print(f"Files with issues: {len(results)}")
    print(f"  🔴 Suspect/orphaned: {len(orphans)}")
    print(f"  🟡 Partially orphaned: {len(partials)}")
    print(f"  🔵 Minor warnings: {len(results) - len(orphans) - len(partials)}")


if __name__ == "__main__":
    main()

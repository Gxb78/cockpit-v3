# -*- coding: utf-8 -*-
"""Fix double-encoded (mojibake) UTF-8 text in Journal app files."""
import re


def fix_mojibake_bytes(raw_bytes):
    """
    Detect and fix double-encoded UTF-8 sequences.

    Pattern: original UTF-8 bytes were read as cp1252, then the resulting
    text was saved again as UTF-8. This produces characteristic byte patterns.

    For example:
    - e-acute (U+00E9) -> UTF-8: \xc3\xa9 -> read as cp1252 -> mojibake -> saved as UTF-8: \xc3\x83\xc2\xa9
    - em dash (U+2014) -> UTF-8: \xe2\x80\x94 -> read as cp1252 -> mojibake -> saved as UTF-8: \xc3\xa2\xe2\x82\xac\xe2\x80\x9d

    Strategy: work at byte level, find sequences that match the double-encoded pattern.
    """
    # Strip BOM if present
    if raw_bytes.startswith(b'\xef\xbb\xbf'):
        raw_bytes = raw_bytes[3:]

    # We'll work by: decode as UTF-8, then for each run of non-ASCII chars,
    # try to encode as cp1252 and re-decode as UTF-8.
    # The trick is identifying which chars are part of double-encoded sequences.

    content = raw_bytes.decode('utf-8')

    def fix_run(m):
        seq = m.group(0)
        # Try to encode as cp1252 bytes, then decode as UTF-8
        try:
            fixed_bytes = seq.encode('cp1252')
            fixed = fixed_bytes.decode('utf-8')
            return fixed
        except (UnicodeEncodeError, UnicodeDecodeError):
            # Try partial fix: process char by char looking for 2-char mojibake pairs
            result = []
            i = 0
            while i < len(seq):
                # Try 4-char window (for 4-byte original UTF-8 like emoji)
                if i + 3 < len(seq):
                    try:
                        b = seq[i:i + 4].encode('cp1252')
                        if len(b) == 4:
                            d = b.decode('utf-8')
                            result.append(d)
                            i += 4
                            continue
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                # Try 3-char window (for 3-byte original UTF-8 like em dash)
                if i + 2 < len(seq):
                    try:
                        b = seq[i:i + 3].encode('cp1252')
                        if len(b) == 3:
                            d = b.decode('utf-8')
                            result.append(d)
                            i += 3
                            continue
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                # Try 2-char window (for 2-byte original UTF-8 like e-acute)
                if i + 1 < len(seq):
                    try:
                        b = seq[i:i + 2].encode('cp1252')
                        if len(b) == 2:
                            d = b.decode('utf-8')
                            result.append(d)
                            i += 2
                            continue
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                # Single char - keep as is
                result.append(seq[i])
                i += 1
            return ''.join(result)

    # Find all runs of non-ASCII characters and try to fix them
    fixed = re.sub(r'[^\x00-\x7f]+', fix_run, content)

    return fixed.encode('utf-8')


def fix_file(path):
    print(f"Processing: {path}")
    with open(path, 'rb') as f:
        original = f.read()

    fixed_bytes = fix_mojibake_bytes(original)
    fixed_text = fixed_bytes.decode('utf-8')
    original_text = original.lstrip(b'\xef\xbb\xbf').decode('utf-8')

    # Count changes
    changes = sum(1 for a, b in zip(original_text, fixed_text) if a != b)
    len_diff = len(original_text) - len(fixed_text)
    print(f"  Changed ~{changes} positions, length diff: {len_diff} chars")

    # Show samples
    for i, (a, b_) in enumerate(zip(original_text, fixed_text)):
        if a != b_:
            ctx_orig = repr(original_text[max(0, i - 5):i + 10])
            ctx_fixed = repr(fixed_text[max(0, i - 5):i + 10])
            print(f"  Sample: {ctx_orig} -> {ctx_fixed}")
            if i > 100:
                print("  ...")
                break

    return fixed_bytes


if __name__ == '__main__':
    import os

    # First do a dry run to show what would change
    files = [
        r'C:\Users\gb781\Desktop\Journal\templates\index.html',
        r'C:\Users\gb781\Desktop\Journal\static\app.js',
    ]

    for path in files:
        if os.path.exists(path):
            result = fix_file(path)

            # Write fixed file
            with open(path, 'wb') as f:
                f.write(result)
            print(f"  Written: {path}")
        else:
            print(f"  NOT FOUND: {path}")

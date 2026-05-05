path = "/mnt/c/Users/gb781/Desktop/Journal/static/js/split/062_chart_page.js"
with open(path, "r", encoding="utf-8", newline="") as f:
    content = f.read()

old = """    return (rows || [])\r
      .filter(function(c) { return c && c.time != null && c.open != null && c.high != null && c.low != null && c.close != null; })\r
      .map(function(c) { return { time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume || 0) }; })\r
      .filter(function(c) { return Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close) && c.high >= c.low; })\r
      .sort(function(a, b) { return a.time - b.time; });"""

new = """    var byTime = {};

    (rows || []).forEach(function (c) {
      if (!c) return;

      var rawTime = c.time != null ? c.time : (c.openTime != null ? c.openTime : c.t);
      var time = _numRequired(rawTime);
      if (time > 1e12) time = Math.floor(time / 1000);

      var open = _numRequired(c.open);
      var high = _numRequired(c.high);
      var low = _numRequired(c.low);
      var close = _numRequired(c.close);
      var volume = _numOptional(c.volume, 0);

      if (!Number.isFinite(time) || time <= 0) return;
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

      if (high < low) return;
      if (high < Math.max(open, close)) return;
      if (low > Math.min(open, close)) return;

      byTime[time] = {
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: volume,
      };
    });

    return Object.keys(byTime)\r
      .map(function (t) { return byTime[t]; })\r
      .sort(function (a, b) { return a.time - b.time; });"""

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print("PATCHED _normalizeChartCandles")
else:
    print("NOT FOUND")
    # dump first 200 chars around 'filter(function(c'
    idx = content.find("filter(function(c)")
    if idx >= 0:
        print(repr(content[max(0,idx-40):idx+200]))

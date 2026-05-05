path = "/mnt/c/Users/gb781/Desktop/Journal/static/js/split/062_chart_page.js"
with open(path, "r", encoding="utf-8", newline="") as f:
    content = f.read()

old = "    var d = JSON.parse(raw);\r\n    var k = d && d.k;\r\n    if (!k) return;\r\n    var candle = {\r\n      time: Math.floor(k.t / 1000),\r\n      openTime: k.t,\r\n      closeTime: k.T,\r\n      open: parseFloat(k.o),\r\n      high: parseFloat(k.h),\r\n      low: parseFloat(k.l),\r\n      close: parseFloat(k.c),\r\n      volume: parseFloat(k.v),\r\n    };\r\n    lastPrice = candle.close;"

new = "    var d = JSON.parse(raw);\r\n    var k = d && d.k;\r\n    if (!k) return;\r\n\r\n    var rawCandle = {\r\n      time: Math.floor(k.t / 1000),\r\n      openTime: k.t,\r\n      closeTime: k.T,\r\n      open: k.o,\r\n      high: k.h,\r\n      low: k.l,\r\n      close: k.c,\r\n      volume: k.v,\r\n    };\r\n\r\n    var candle = _normalizeLiveChartCandle(rawCandle);\r\n    if (!candle) {\r\n      console.warn('[chart][WS] invalid candle ignored', {\r\n        interval: currentInterval,\r\n        raw: rawCandle,\r\n      });\r\n      return;\r\n    }\r\n\r\n    lastPrice = candle.close;"

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    print("PATCHED")
else:
    print("STILL NOT FOUND")

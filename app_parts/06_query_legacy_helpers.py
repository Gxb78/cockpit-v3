def _query_days(*, month=None, instrument=None, date_from=None, date_to=None, search=None):
    db = get_db()
    query = "SELECT * FROM days WHERE 1=1"
    params = []

    if month:
        query += " AND substr(date,1,7)=?"
        params.append(month)
    if date_from:
        query += " AND date>=?"
        params.append(date_from)
    if date_to:
        query += " AND date<=?"
        params.append(date_to)
    if instrument and instrument != "ALL":
        instrument = _canonical_instrument(instrument)
        query += " AND instrument=?"
        params.append(instrument)
    if search:
        like = f"%{search}%"
        query += """ AND (
            COALESCE(htf_context,'') LIKE ? OR
            COALESCE(daily_notes,'') LIKE ? OR COALESCE(tags,'') LIKE ? OR
            id IN (
                SELECT DISTINCT day_id FROM trades WHERE
                    COALESCE(why_trade,'') LIKE ? OR COALESCE(why_entry,'') LIKE ? OR
                    COALESCE(why_stop,'') LIKE ? OR COALESCE(why_tp,'') LIKE ? OR COALESCE(scenario,'') LIKE ? OR
                    COALESCE(stdv_level,'') LIKE ? OR COALESCE(lessons_learned,'') LIKE ? OR
                    COALESCE(tags,'') LIKE ?
            ))"""
        params.extend([like] * 12)

    query += " ORDER BY date DESC, instrument"
    days = []
    for r in db.execute(query, params).fetchall():
        d = row_to_dict(r)
        d["tags"] = _decode_json(d.get("tags"), [])
        d["trades"] = _fetch_trades_for_day(d["id"])
        days.append(d)
    return days

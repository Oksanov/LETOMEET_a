"""Admin endpoints."""
from main import *  # Shared application, models, and service helpers

@app.get("/api/admin/users")
def admin_users():
    user, error = admin_required()

    if error:
        return error

    users = User.query.order_by(
        User.created_at.desc()
    ).all()

    return jsonify({
        "users": [
            user.to_dict()
            for user in users
        ]
    })

@app.get("/api/admin/stats")
def admin_stats():
    user, error = admin_required()

    if error:
        return error

    return jsonify({
        "users": User.query.count(),
        "admins": User.query.filter_by(
            role="admin"
        ).count()
    })

@app.get("/api/admin/events")
def admin_events():
    user, error = admin_required()
    if error:
        return error

    events = Event.query.order_by(
        Event.date,
        Event.time,
        Event.id
    ).all()

    return jsonify({
        "events": [event.to_dict(include_changes=True) for event in events]
    })

@app.post("/api/admin/events/<int:event_id>/approve")
def approve_event(event_id):
    user, error = admin_required()
    if error:
        return error

    event = Event.query.filter_by(id=event_id).with_for_update().first_or_404()

    change = db.session.get(EventChange, event.id)
    if event.status == "approved" and change and change.state == "pending":
        if (request.get_json(silent=True) or {}).get("change_id") != change.version:
            return jsonify(error="Автор обновил изменения. Обновите админ-панель перед одобрением."), 409
        values = json.loads(change.payload)
        if values["date"] < school_today().isoformat():
            return jsonify(error="Дата изменений уже прошла. Верните изменения автору для исправления."), 409
        for field, value in values.items():
            setattr(event, field, value)
        event.moderation_comment = None
        db.session.delete(change)
    elif event.status == "pending":
        event.status = "approved"
        event.moderation_comment = None
    else:
        return jsonify(error="Нет изменений, ожидающих одобрения"), 409
    db.session.commit()
    return jsonify(success=True, event=event.to_dict(include_changes=True))

@app.post("/api/admin/events/<int:event_id>/reject-change")
def reject_event_change(event_id):
    user, error = admin_required()
    if error:
        return error
    event = Event.query.filter_by(id=event_id).with_for_update().first_or_404()
    change = db.session.get(EventChange, event_id)
    if event.status != "approved" or not change or change.state != "pending":
        return jsonify(error="Нет изменений, ожидающих модерации"), 409
    data = request.get_json(silent=True) or {}
    if data.get("change_id") != change.version:
        return jsonify(error="Автор обновил изменения. Обновите админ-панель."), 409
    destination = data.get("destination")
    comment = data.get("comment")
    if destination not in {"rejected", "revision"} or not isinstance(comment, str) or not comment.strip() or len(comment) > 2000:
        return jsonify(error="Выберите решение и добавьте комментарий до 2000 символов"), 400
    change.state = destination
    change.comment = comment.strip()
    db.session.commit()
    return jsonify(success=True, event=event.to_dict(include_changes=True))

@app.post("/api/admin/events/<int:event_id>/reject")
@app.post("/api/admin/events/<int:event_id>/unpublish")
def reject_event(event_id):
    user, error = admin_required()
    if error:
        return error
    event = db.get_or_404(Event, event_id)
    if event.status not in {"pending", "approved"}:
        return jsonify(error="Статус события уже изменился. Обновите страницу."), 409
    data = request.get_json(silent=True) or {}
    destination = data.get("destination", "rejected")
    if destination not in {"rejected", "revision"}:
        return jsonify(error="Выберите, куда отправить событие"), 400
    comment = data.get("comment", "")
    if not isinstance(comment, str) or not comment.strip() or len(comment) > 2000:
        return jsonify(error="Добавьте комментарий от 1 до 2000 символов"), 400
    EventChange.query.filter_by(event_id=event_id).delete(synchronize_session=False)
    old_status = event.status
    changed = Event.query.filter_by(id=event.id, status=old_status).update(
        {"status": destination, "moderation_comment": comment.strip()}, synchronize_session=False)
    if not changed:
        db.session.rollback()
        return jsonify(error="Статус события уже изменился. Обновите страницу."), 409
    db.session.commit()
    db.session.expire_all()
    return jsonify(success=True, event=db.session.get(Event, event_id).to_dict())

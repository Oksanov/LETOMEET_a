"""Events endpoints."""
from main import *  # Shared application, models, and service helpers

@app.route("/api/events/<int:event_id>/comments", methods=["GET", "POST"])
def event_comments(event_id):
    event = db.get_or_404(Event, event_id)
    user = current_user()
    if event.status != "approved":
        return jsonify(error="Событие не опубликовано"), 404
    if request.method == "POST":
        if not user:
            return jsonify(error="Необходимо войти"), 401
        body = str((request.get_json(silent=True) or {}).get("body", "")).strip()
        if not 1 <= len(body) <= 2000:
            return jsonify(error="Комментарий: от 1 до 2000 символов"), 400
        recent = Comment.query.filter(Comment.user_id == user.id, Comment.created_at > datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=10)).first()
        if recent:
            return jsonify(error="Подождите 10 секунд"), 429
        db.session.add(Comment(event_id=event_id, user_id=user.id, body=body))
        db.session.commit()
    rows = Comment.query.filter_by(event_id=event_id).order_by(Comment.id.desc()).limit(100).all()
    return jsonify([dict(id=c.id, body=c.body, author=db.session.get(User, c.user_id).username,
                         avatar_url=(db.session.get(Profile, c.user_id).avatar_url if db.session.get(Profile, c.user_id) else None),
                         created_at=c.created_at.isoformat()+"Z", can_delete=bool(user and (user.id == c.user_id or user.role == "admin"))) for c in rows])

@app.delete("/api/comments/<int:comment_id>")
def delete_comment(comment_id):
    user = current_user()
    comment = db.get_or_404(Comment, comment_id)
    if not user or (user.id != comment.user_id and user.role != "admin"):
        return jsonify(error="Доступ запрещён"), 403
    db.session.delete(comment)
    db.session.commit()
    return jsonify(ok=True)

@app.get("/api/events")
def api_events():
    filtered = filter_events(
        Event.query.filter_by(status="approved"),
        request.args
    )
    return jsonify([event.to_dict() for event in filtered])

@app.get("/api/events/<int:event_id>")
def api_event(event_id):
    event = Event.query.get_or_404(event_id)

    if event.status != "approved":
        user = current_user()

        if not user or (user.role != "admin" and event.creator_id != user.id):
            return jsonify({"error": "Мероприятие не опубликовано"}), 404

    user = current_user()
    return jsonify(event.to_dict(include_changes=bool(user and (user.role == "admin" or user.id == event.creator_id))))

@app.get("/api/filter-groups")
def api_filter_groups():
    return jsonify(FILTER_GROUPS)

@app.post("/api/events")
def api_create_event():
    user = current_user()
    if not user:
        return jsonify(error="Необходимо войти в аккаунт"), 401
    values, error = event_form(request.get_json(silent=True) or {}, user.id)
    if error:
        return error
    event = Event(**values, creator_id=user.id, status="pending", count=1)
    db.session.add(event)
    db.session.flush()
    db.session.add(Registration(user_id=user.id, event_id=event.id))
    db.session.commit()
    return jsonify(event.to_dict()), 201

@app.put("/api/events/<int:event_id>")
def api_edit_event(event_id):
    user = current_user()
    if not user:
        return jsonify(error="Необходимо войти в аккаунт"), 401
    event = Event.query.filter_by(id=event_id).with_for_update().first_or_404()
    if event.creator_id != user.id:
        return jsonify(error="Вы можете редактировать только свои мероприятия"), 403
    if event.status in {"rejected", "past"}:
        return jsonify(error="Это событие нельзя редактировать. Создайте новое событие."), 409
    values, error = event_form(request.get_json(silent=True) or {}, user.id, event)
    if error:
        return error
    if event.status == "approved":
        change = db.session.get(EventChange, event.id)
        if not change:
            change = EventChange(event_id=event.id)
            db.session.add(change)
        change.payload = json.dumps(values, ensure_ascii=False)
        change.version = uuid.uuid4().hex
        change.state = "pending"
        change.comment = None
        db.session.commit()
        return jsonify(success=True, message="Изменения отправлены на модерацию. Опубликованная версия остаётся доступна.", event=event.to_dict(include_changes=True))
    values.update(status="pending", moderation_comment=None)
    changed = Event.query.filter_by(id=event_id, creator_id=user.id, status=event.status).update(values, synchronize_session=False)
    if not changed:
        db.session.rollback()
        return jsonify(error="Статус уже изменился. Обновите страницу."), 409
    db.session.commit()
    db.session.expire_all()
    return jsonify(success=True, message="Исправленное мероприятие отправлено на повторную модерацию", event=db.session.get(Event, event_id).to_dict())

@app.delete("/api/events/<int:event_id>")
def delete_event(event_id):
    user = current_user()
    if not user:
        return jsonify(error="Необходимо войти"), 401
    event = db.get_or_404(Event, event_id)
    if event.creator_id != user.id and user.role != "admin":
        return jsonify(error="Вы можете удалять только свои мероприятия"), 403
    EventChange.query.filter_by(event_id=event_id).delete(synchronize_session=False)
    Comment.query.filter_by(event_id=event_id).delete(synchronize_session=False)
    Registration.query.filter_by(event_id=event_id).delete(synchronize_session=False)
    db.session.delete(event)
    db.session.commit()
    return jsonify(success=True)

@app.get("/api/events/<int:event_id>/qr")
def event_qr(event_id):
    # QR-коды публичны только для опубликованных мероприятий.
    event = Event.query.filter_by(id=event_id, status="approved").first()
    if not event:
        return jsonify(error="QR-код доступен только для опубликованных мероприятий"), 404

    # PUBLIC_BASE_URL задаётся для корректной ссылки за reverse proxy.
    base_url = os.environ.get("PUBLIC_BASE_URL", request.url_root.rstrip("/")).rstrip("/")
    event_url = f"{base_url}/events/{event.id}"

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4
    )
    qr.add_data(event_url)
    qr.make(fit=True)

    image = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype="image/png",
        as_attachment=request.args.get("download") == "1",
        download_name=f"letomeet-event-{event.id}-qr.png",
        max_age=3600
    )

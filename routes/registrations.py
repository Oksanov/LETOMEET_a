"""Registrations endpoints."""
from main import *  # Shared application, models, and service helpers

@app.route("/api/events/<int:event_id>/join", methods=["POST"])
def join_event(event_id):
    # Проверяем, вошёл ли пользователь
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    # Проверяем, существует ли мероприятие
    event = Event.query.filter_by(id=event_id).with_for_update().first()

    if not event:
        return jsonify({"error": "Мероприятие не найдено"}), 404

    if event.status != "approved":
        return jsonify(error="Событие не опубликовано"), 404

    # Проверяем, не записан ли пользователь уже
    existing_registration = Registration.query.filter_by(
        user_id=user_id,
        event_id=event_id
    ).first()

    if existing_registration:
        return jsonify({"error": "Вы уже записаны на это мероприятие"}), 400

    registration = Registration(
        user_id=user_id,
        event_id=event_id
    )

    db.session.add(registration)

    event.count += 1

    db.session.commit()

    return jsonify({
        "message": "Вы успешно записались",
        "event_id": event_id
    }), 201

@app.route("/api/events/<int:event_id>/join", methods=["DELETE"])
def leave_event(event_id):
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    event = Event.query.filter_by(id=event_id).with_for_update().first()

    if event and event.creator_id == user_id:
        return jsonify(error="Организатор участвует в своём мероприятии автоматически"), 409

    registration = Registration.query.filter_by(
        user_id=user_id,
        event_id=event_id
    ).first()

    if not registration:
        return jsonify({"error": "Вы не записаны на это мероприятие"}), 400


    if not event:
        return jsonify({"error": "Мероприятие не найдено"}), 404

    db.session.delete(registration)

    if event.count > 0:
        event.count -= 1

    db.session.commit()

    return jsonify({
        "message": "Запись отменена",
        "event_id": event_id
    })

@app.route("/api/me/registrations", methods=["GET"])
def my_registrations():
    user_id = session.get("user_id")

    if not user_id:
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    registrations = Registration.query.filter_by(
        user_id=user_id
    ).all()

    events = []

    for registration in registrations:
        event = Event.query.get(registration.event_id)

        if event:
            events.append(event.to_dict())

    return jsonify({
        "events": events
    })

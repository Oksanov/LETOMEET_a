"""Media endpoints."""
from main import *  # Shared application, models, and service helpers

@app.get("/api/maintenance/events")
def scheduled_event_maintenance():
    secret = os.environ.get("CRON_SECRET")
    if not secret or not secrets.compare_digest(request.headers.get("Authorization", ""), "Bearer " + secret):
        return jsonify(error="Доступ запрещён"), 403
    return jsonify(maintain_events())

@app.get("/media/<filename>")
def media(filename):
    if re.fullmatch(r"[a-f0-9]{32}\.jpg", filename):
        stored = db.session.get(EventImage, filename[:-4])
        if stored:
            response = send_file(io.BytesIO(stored.data), mimetype="image/jpeg", download_name=filename,
                                 max_age=86400, etag=stored.id, conditional=True)
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
    # Keep pre-update local photo URLs working on persistent servers.
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.post("/api/upload-image")
def api_upload_image():
    if not session.get("user_id"):
        return jsonify({"error": "Необходимо войти в аккаунт"}), 401

    if "image" not in request.files:
        return jsonify({"error": "Изображение не выбрано"}), 400

    image = request.files["image"]

    if not image.filename:
        return jsonify({"error": "Изображение не выбрано"}), 400

    # Only inspect the extension: storage always uses a generated UUID.
    # Sanitizing a Cyrillic-only basename can accidentally remove its dot.
    extension = os.path.splitext(image.filename)[1].lower()

    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}

    if extension not in allowed_extensions:
        return jsonify({
            "error": "Поддерживаются только JPG, PNG и WEBP"
        }), 400

    raw = image.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        return jsonify(error="Фото должно быть не больше 4 МБ."), 413
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                return jsonify(error="Выберите настоящее изображение JPG, PNG или WEBP. HEIC и SVG не поддерживаются."), 400
            if source.width * source.height > 20000000:
                return jsonify(error="Фото слишком большое: максимум 20 мегапикселей. Уменьшите разрешение."), 400
            source.load()
            source = ImageOps.exif_transpose(source)
            source.thumbnail((2400, 2400))
            rgba = source.convert("RGBA")
            clean = Image.new("RGB", rgba.size, "white")
            clean.paste(rgba, mask=rgba.getchannel("A"))
            encoded = io.BytesIO()
            clean.save(encoded, "JPEG", quality=88)
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        return jsonify(error="Не удалось прочитать фото. Сохраните его как JPG, PNG или WEBP и выберите снова."), 400
    photo_id = uuid.uuid4().hex
    try:
        db.session.add(EventImage(id=photo_id, user_id=session["user_id"], data=encoded.getvalue()))
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception("Could not save event photo")
        return jsonify(error="Не удалось сохранить фото. Попробуйте позже или создайте событие без фото."), 503
    image_url = f"/media/{photo_id}.jpg"

    return jsonify({
        "image_url": image_url
    }), 201

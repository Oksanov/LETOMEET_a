"""Pages endpoints."""
from main import *  # Shared application, models, and service helpers

@app.get('/favicon.ico')
def favicon():
    return '', 204

@app.get("/")
@app.get("/events")
@app.get("/events/<int:event_id>")
@app.get("/map")
def index_pages(event_id=None):
    return render_template("index.html")

@app.get("/admin")
def admin_page():
    user = current_user()

    if not user:
        return render_template("index.html")

    if user.role != "admin":
        return render_template("index.html")

    return render_template("admin.html")

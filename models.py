"""SQLAlchemy models used by LETOMEET."""
from datetime import datetime, timezone
import json
import uuid

from extensions import db

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(
        db.String(80),
        nullable=False
    )

    email = db.Column(
        db.String(150),
        unique=True,
        nullable=False
    )

    role = db.Column(
        db.String(20),
        nullable=False,
        default="user"
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self):
        profile = db.session.get(Profile, self.id)
        appearance = db.session.get(ProfileAppearance, self.id)
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "avatar_url": (profile.avatar_url if profile else None),
            "banner_url": (profile.banner_url if profile else None),
            "role": self.role,
            "avatar_color": appearance.avatar_color if appearance else "#e3cd86",
            "banner_color": appearance.banner_color if appearance else "#e3cd86"
        }

class Profile(db.Model):
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), primary_key=True)
    avatar_url = db.Column(db.String(500), nullable=True)
    banner_url = db.Column(db.String(500), nullable=True)

class ProfileAppearance(db.Model):
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), primary_key=True)
    avatar_color = db.Column(db.String(7), nullable=False, default="#e3cd86")
    banner_color = db.Column(db.String(7), nullable=False, default="#e3cd86")

class AuthCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    email = db.Column(
        db.String(150),
        nullable=False
    )

    username = db.Column(
        db.String(80),
        nullable=True
    )

    purpose = db.Column(
        db.String(20),
        nullable=False
    )

    code_hash = db.Column(
        db.String(255),
        nullable=False
    )

    expires_at = db.Column(
        db.DateTime,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    title = db.Column(db.String(150), nullable=False)
    summary = db.Column(db.String(300), nullable=True)
    description = db.Column(db.Text, nullable=False)
    activity = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(100), nullable=False)
    duration = db.Column(db.String(50), nullable=False)
    place = db.Column(db.String(100), nullable=False)
    room = db.Column(db.String(100), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    time = db.Column(db.String(10), nullable=False)
    end = db.Column(db.String(10), nullable=False)
    regular = db.Column(db.Boolean, default=False)
    organizer = db.Column(db.String(100), nullable=False)
    count = db.Column(db.Integer, default=0)
    chat = db.Column(db.String(200), default="")
    contact = db.Column(db.String(200), default="")
    status = db.Column(db.String(20), nullable=False, default="pending")
    moderation_comment = db.Column(db.Text, nullable=True)
    image_url = db.Column(db.String(500), nullable=True)
    card_color = db.Column(db.String(20), nullable=False, default="cream")
    card_emoji = db.Column(db.String(20), nullable=True)
    tagline = db.Column(db.String(80), nullable=True)

    def to_dict(self, include_changes=False):
        """Converts the SQL row into a regular dictionary for the API responses"""
        result = {
            "id": self.id,
            "title": self.title,
            "creator_id": self.creator_id,
            "summary": self.summary,
            "description": self.description,
            "activity": self.activity,
            "type": self.type,
            "duration": self.duration,
            "place": self.place,
            "room": self.room,
            "date": self.date,
            "time": self.time,
            "end": self.end,
            "regular": self.regular,
            "organizer": self.organizer,
            "count": self.count,
            "chat": self.chat,
            "contact": self.contact,
            "status": self.status,
            "moderation_comment": self.moderation_comment,
            "image_url": self.image_url,
            "card_color": self.card_color,
            "card_emoji": self.card_emoji,
            "tagline": self.tagline
        }

        if include_changes:
            change = db.session.get(EventChange, self.id)
            result["pending_changes"] = json.loads(change.payload) if change else None
            result["change_id"] = change.version if change else None
            result["change_status"] = change.state if change else None
            result["change_comment"] = change.comment if change else None
        return result

class EventChange(db.Model):
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), primary_key=True)
    payload = db.Column(db.Text, nullable=False)
    version = db.Column(db.String(32), nullable=False, default=lambda: uuid.uuid4().hex)
    state = db.Column(db.String(20), nullable=False, default="pending")
    comment = db.Column(db.Text, nullable=True)

class Registration(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("user.id"),
        nullable=False
    )

    event_id = db.Column(
        db.Integer,
        db.ForeignKey("event.id"),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

class SecurityCounter(db.Model):
    key = db.Column(db.String(240), primary_key=True)
    count = db.Column(db.Integer, default=0)
    reset = db.Column(db.DateTime, nullable=False)

class EventImage(db.Model):
    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("event.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    body = db.Column(db.String(2000), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

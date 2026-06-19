"""In-memory editable schema sessions."""

from __future__ import annotations

import uuid

from dataharmonizer_template_builder.models import SchemaSession, TableRows


class SessionStore:
    """Store schema editing sessions for the current backend process."""

    def __init__(self) -> None:
        self._sessions: dict[str, SchemaSession] = {}

    def create(
        self,
        *,
        source_yaml: str,
        schema_name: str,
        tables: TableRows,
        source_id: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> SchemaSession:
        """Create and return a session."""
        session_id = uuid.uuid4().hex
        session = SchemaSession(
            session_id=session_id,
            source_yaml=source_yaml,
            schema_name=schema_name,
            tables=tables,
            source_id=source_id,
            metadata=metadata or {},
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> SchemaSession:
        """Return a session by ID.

        Raises:
            KeyError: If the session ID is unknown.
        """
        return self._sessions[session_id]

    def update_tables(self, session_id: str, tables: TableRows) -> SchemaSession:
        """Replace a session's editable tables and return the session."""
        session = self.get(session_id)
        session.tables = tables
        return session


store = SessionStore()

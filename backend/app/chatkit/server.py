"""ChatKit server scaffolding for the future self-hosted report workflow.

This module intentionally stops short of selecting and implementing the ChatKit
conversation persistence layer. The next pass can wire these hooks once the
storage design is settled.
"""

from dataclasses import dataclass


@dataclass
class ChatKitScaffoldConfig:
    app_name: str = "Report Foundry"
    session_endpoint: str = "/api/chatkit/session"
    event_endpoint: str = "/api/chatkit/events"
    note: str = "Persistence intentionally not implemented yet."


chatkit_scaffold = ChatKitScaffoldConfig()

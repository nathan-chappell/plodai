from pydantic import SecretStr
from sqlalchemy import Text, TypeDecorator


class SecretStrText(TypeDecorator[SecretStr]):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: SecretStr | str | None, dialect):
        if value is None:
            return None
        if isinstance(value, SecretStr):
            return value.get_secret_value()
        return str(value)

    def process_result_value(self, value: str | None, dialect):
        if value is None:
            return None
        return SecretStr(value)

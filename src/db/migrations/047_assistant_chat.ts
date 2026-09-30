// Donde vive lo que se habla con el asistente.
//
// Cada chat es una conversacion con su fecha, y abrir uno nuevo no borra el anterior:
// eso lo pidio asi, y ademas es lo unico que permite mirar despues que se le dijo y que
// contesto cuando algo salga mal.
//
// El mensaje guarda el texto y nada mas. Lo que un comando escribio queda en la tabla
// que le toca (el registro del dia, la serie), no aqui: dos copias del mismo dato es
// como se acaba con dos verdades distintas.
export const sql = `
CREATE TABLE core_assistant_chat (
  id         TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);

CREATE TABLE core_assistant_message (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES core_assistant_chat(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('me', 'app')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_assistant_message_chat ON core_assistant_message (chat_id, created_at);
`;

import { FormEvent, useState } from "react";
import styled from "styled-components";

import { apiRequest, storeToken } from "../lib/api";
import type { AuthUser, LoginResponse } from "../types/auth";

const Card = styled.section`
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 1.2rem;
  display: grid;
  gap: 0.8rem;
`;

const Row = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const Input = styled.input`
  border-radius: var(--radius-md);
  border: 1px solid var(--line);
  padding: 0.8rem 0.9rem;
`;

const Button = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 0.8rem 1rem;
  background: var(--ink);
  color: white;
  font-weight: 700;
  cursor: pointer;
`;

const Meta = styled.div`
  color: var(--muted);
  font-size: 0.92rem;
`;

export function AuthPanel({
  user,
  onAuthenticated,
}: {
  user: AuthUser | null;
  onAuthenticated: (user: AuthUser | null) => void;
}) {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Use the seeded file users or the env-bootstrapped admin.");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    try {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      storeToken(response.access_token);
      onAuthenticated(response.user);
      setMessage(`Signed in as ${response.user.email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    }
  }

  function handleLogout() {
    storeToken(null);
    onAuthenticated(null);
    setMessage("Signed out.");
  }

  return (
    <Card>
      <h2>Auth</h2>
      {user ? (
        <>
          <strong>{user.full_name || user.email}</strong>
          <Meta>
            {user.email} · {user.role}
          </Meta>
          <Button onClick={handleLogout} type="button">
            Sign out
          </Button>
        </>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Row>
            <label htmlFor="email">Email</label>
            <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Row>
          <Row>
            <label htmlFor="password">Password</label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Row>
          <Button type="submit">Sign in</Button>
        </form>
      )}
      <Meta>{message}</Meta>
    </Card>
  );
}

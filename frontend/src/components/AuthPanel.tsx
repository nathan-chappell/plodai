import { FormEvent, useState } from "react";
import styled from "styled-components";

import { apiRequest, storeToken } from "../lib/api";
import type { AuthUser, LoginResponse } from "../types/auth";
import { MetaText, inputSurfaceCss, panelSurfaceCss, primaryButtonCss } from "../ui/primitives";

const Card = styled.section`
  ${panelSurfaceCss};
  padding: 1.2rem;
  display: grid;
  gap: 0.8rem;
`;

const Row = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const Input = styled.input`
  ${inputSurfaceCss};
`;

const Button = styled.button`
  ${primaryButtonCss};
  padding: 0.8rem 1rem;
  background: var(--ink);
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
          <MetaText as="div">
            {user.email} · {user.role}
          </MetaText>
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
      <MetaText as="div">{message}</MetaText>
    </Card>
  );
}

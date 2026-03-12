import { FormEvent, useEffect, useState } from "react";
import styled from "styled-components";

import { apiRequest } from "../lib/api";
import type { AuthUser, CreateUserRequest, UserListResponse } from "../types/auth";
import { MetaText, inputSurfaceCss, panelSurfaceCss, primaryButtonCss } from "../ui/primitives";

const Panel = styled.section`
  ${panelSurfaceCss};
  padding: 1.2rem;
  display: grid;
  gap: 0.9rem;
`;

const Heading = styled.h3`
  margin: 0;
`;

const Row = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const FormGrid = styled.form`
  display: grid;
  gap: 0.8rem;
`;

const Input = styled.input`
  ${inputSurfaceCss};
`;

const Select = styled.select`
  ${inputSurfaceCss};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
`;

const PrimaryButton = styled.button`
  ${primaryButtonCss};
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
`;

const SecondaryButton = styled.button`
  ${primaryButtonCss};
  background: rgba(31, 41, 55, 0.12);
  color: var(--ink);
`;

const UserList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.7rem;
`;

const UserCard = styled.li`
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
  display: grid;
  gap: 0.45rem;
`;

const InlineMeta = styled.div`
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
`;

export function AdminPanel({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading users...");
  const [form, setForm] = useState<CreateUserRequest>({
    email: "",
    password: "",
    full_name: "",
    role: "user",
    is_active: true,
  });

  async function loadUsers() {
    setLoading(true);
    try {
      const response = await apiRequest<UserListResponse>("/auth/users");
      setUsers(response.users);
      setMessage(`Loaded ${response.users.length} user${response.users.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await apiRequest<AuthUser>("/auth/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setUsers((current) => [...current, created].sort((left, right) => left.email.localeCompare(right.email)));
      setForm({
        email: "",
        password: "",
        full_name: "",
        role: "user",
        is_active: true,
      });
      setMessage(`Created user ${created.email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create user.");
    }
  }

  async function handleDelete(user: AuthUser) {
    try {
      await apiRequest<void>(`/auth/users/${user.id}`, {
        method: "DELETE",
      });
      setUsers((current) => current.filter((candidate) => candidate.id !== user.id));
      setMessage(`Removed user ${user.email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove user.");
    }
  }

  return (
    <Panel>
      <Heading>Admin users</Heading>
      <MetaText>Create or remove users for this demo environment.</MetaText>
      <FormGrid onSubmit={(event) => void handleSubmit(event)}>
        <Row>
          <label htmlFor="admin-email">Email</label>
          <Input
            id="admin-email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Row>
        <Row>
          <label htmlFor="admin-password">Password</label>
          <Input
            id="admin-password"
            type="password"
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
          />
        </Row>
        <Row>
          <label htmlFor="admin-name">Full name</label>
          <Input
            id="admin-name"
            value={form.full_name}
            onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
          />
        </Row>
        <Row>
          <label htmlFor="admin-role">Role</label>
          <Select
            id="admin-role"
            value={form.role}
            onChange={(event) =>
              setForm((current) => ({ ...current, role: event.target.value as CreateUserRequest["role"] }))
            }
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
        </Row>
        <ButtonRow>
          <PrimaryButton type="submit">Add user</PrimaryButton>
          <SecondaryButton onClick={() => void loadUsers()} type="button">
            Refresh
          </SecondaryButton>
        </ButtonRow>
      </FormGrid>
      <MetaText>{message}</MetaText>
      {loading ? (
        <MetaText>Loading user list…</MetaText>
      ) : (
        <UserList>
          {users.map((user) => (
            <UserCard key={user.id}>
              <strong>{user.full_name || user.email}</strong>
              <InlineMeta>
                <MetaText as="span">{user.email}</MetaText>
                <MetaText as="span">{user.role}</MetaText>
                <MetaText as="span">{user.is_active ? "active" : "inactive"}</MetaText>
              </InlineMeta>
              <ButtonRow>
                <SecondaryButton
                  disabled={user.id === currentUser.id}
                  onClick={() => void handleDelete(user)}
                  type="button"
                >
                  Remove user
                </SecondaryButton>
              </ButtonRow>
            </UserCard>
          ))}
        </UserList>
      )}
    </Panel>
  );
}

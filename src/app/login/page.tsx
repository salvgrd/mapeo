"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">Entrar</h1>
        <label className="block">
          <span className="text-sm text-neutral-600">Usuario</span>
          <input
            name="username"
            autoComplete="username"
            required
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-600">Contraseña</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        {state.error && <p className="text-sm text-red-700">{state.error}</p>}
        <button
          disabled={pending}
          className="w-full rounded bg-neutral-900 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
        <Link href="/" className="block text-center text-sm text-neutral-600 underline">
          Volver al mapa
        </Link>
      </form>
    </main>
  );
}

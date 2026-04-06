"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "utbytte_user_id";

export function useUserId(): string {
  const [userId, setUserId] = useState<string>("");

  useEffect(() => {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    setUserId(id);
  }, []);

  return userId;
}

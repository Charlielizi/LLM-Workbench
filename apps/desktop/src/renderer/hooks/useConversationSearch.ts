import { useEffect, useState } from "react";
import { useAppStore } from "../stores/app-store";

export function useConversationSearch() {
  const [query, setQuery] = useState("");
  const searchConversations = useAppStore(
    (state) => state.searchConversations,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchConversations(query);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, searchConversations]);

  return { query, setQuery };
}

"use client";

/** Settings card for the Tiingo market-data connection (API key only — benchmark/index price history). Same layout as SimplefinCard. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ConnectionStatusLine,
  ConnectionResultMessage,
} from "./integrations/connection-card";

export function TiingoCard() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = useState("");
  const [showUpdateKey, setShowUpdateKey] = useState(false);

  const { data: status } = trpc.tiingo.getStatus.useQuery();
  const isConnected = status?.connected ?? false;

  const invalidate = () => {
    utils.tiingo.getStatus.invalidate();
  };

  const saveKeyMut = trpc.tiingo.saveKey.useMutation({
    onSuccess: () => {
      invalidate();
      setApiKey("");
      setShowUpdateKey(false);
    },
  });
  const testConnectionMut = trpc.tiingo.testConnection.useMutation();
  const removeConnectionMut = trpc.tiingo.removeConnection.useMutation({
    onSuccess: invalidate,
  });

  const handleSave = () => {
    if (!apiKey) return;
    saveKeyMut.mutate({ apiKey });
  };

  const handleRemove = () => {
    if (!confirm("Remove Tiingo connection?")) return;
    removeConnectionMut.mutate();
  };

  return (
    <Card title="Tiingo">
      <div className="space-y-4">
        <p className="text-muted text-xs">
          Links to{" "}
          <a
            href="https://www.tiingo.com/account/api/token"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary underline"
          >
            Tiingo
          </a>{" "}
          for historical index and fund prices, used to compare your portfolio
          against market benchmarks. Read-only — the free tier is enough.
        </p>

        {isConnected && (
          <ConnectionStatusLine
            connected
            extra={
              status?.lastSyncedAt && (
                <span className="text-caption text-faint">
                  Last synced {new Date(status.lastSyncedAt).toLocaleString()}
                </span>
              )
            }
          />
        )}

        {(!isConnected || showUpdateKey) && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="tiingo-api-key"
                className="text-muted mb-1 block text-xs font-medium"
              >
                API Key
              </label>
              <input
                id="tiingo-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API token from your Tiingo account"
                className="border-strong w-full rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={!apiKey || saveKeyMut.isPending}
              >
                {saveKeyMut.isPending ? "Connecting..." : "Connect"}
              </Button>
              {showUpdateKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowUpdateKey(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
            {saveKeyMut.isError && (
              <ConnectionResultMessage tone="error">
                {saveKeyMut.error.message}
              </ConnectionResultMessage>
            )}
          </div>
        )}

        {isConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => testConnectionMut.mutate()}
              disabled={testConnectionMut.isPending}
            >
              {testConnectionMut.isPending ? "Testing..." : "Test"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpdateKey(!showUpdateKey)}
            >
              {showUpdateKey ? "Hide" : "Change Key"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleRemove}
              disabled={removeConnectionMut.isPending}
            >
              Remove
            </Button>
          </div>
        )}

        {testConnectionMut.isSuccess && testConnectionMut.data && (
          <ConnectionResultMessage
            tone={testConnectionMut.data.success ? "success" : "error"}
          >
            {testConnectionMut.data.success
              ? `Connected: ${testConnectionMut.data.ticker} history available from ${testConnectionMut.data.historyStart}`
              : testConnectionMut.data.error}
          </ConnectionResultMessage>
        )}
      </div>
    </Card>
  );
}

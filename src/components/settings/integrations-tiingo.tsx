"use client";

/** Settings card for the Tiingo market-data connection (API key only — benchmark/index price history). Same layout as SimplefinCard. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { errorText } from "@/lib/utils/mutation-error";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ConnectionResultMessage,
  LastSyncedStatus,
  SecretConnectForm,
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
          <LastSyncedStatus lastSyncedAt={status?.lastSyncedAt} />
        )}

        {(!isConnected || showUpdateKey) && (
          <SecretConnectForm
            inputId="tiingo-api-key"
            label="API Key"
            placeholder="API token from your Tiingo account"
            value={apiKey}
            onChange={setApiKey}
            onConnect={handleSave}
            pending={saveKeyMut.isPending}
            showCancel={showUpdateKey}
            onCancel={() => setShowUpdateKey(false)}
            errorMessage={
              saveKeyMut.isError ? errorText(saveKeyMut.error) : null
            }
          />
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

        {testConnectionMut.isSuccess && (
          <ConnectionResultMessage
            tone={testConnectionMut.data.ok ? "success" : "error"}
          >
            {testConnectionMut.data.ok
              ? testConnectionMut.data.historyStart
                ? `Connected: ${testConnectionMut.data.ticker} history available from ${testConnectionMut.data.historyStart}`
                : `Connected: Tiingo lists no price history for ${testConnectionMut.data.ticker}`
              : testConnectionMut.data.error}
          </ConnectionResultMessage>
        )}
      </div>
    </Card>
  );
}

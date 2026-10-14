<?php

namespace Webkul\Turnkey\Support;

use Illuminate\Database\Connection;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use WeakMap;

final class ReadOnlyDatabase
{
    private WeakMap $connections;

    public function __construct()
    {
        $this->connections = new WeakMap;
    }

    public function protect(Connection $connection): void
    {
        if (isset($this->connections[$connection])) {
            return;
        }

        $connection->beforeExecuting(function (string $query): void {
            if (! $this->isReadQuery($query)) {
                // Do not include SQL or bindings in a public error response.
                throw new AccessDeniedHttpException('This demo is read-only. Database changes are disabled.');
            }
        });

        $this->connections[$connection] = true;
    }

    private function isReadQuery(string $query): bool
    {
        // Ignore literal/identifier contents and ordinary comments when classifying
        // SQL. Backslash quoting and # comments are unsupported: dialects differ.
        $unsafeComment = false;
        $sql = preg_replace_callback(<<<'REGEX'
            ~'(?:''|[^'\\])*'|"(?:""|[^"\\])*"|`(?:``|[^`\\])*`|/\*.*?\*/|--(?=[\x00-\x20])[^\r\n]*~s
            REGEX, function (array $match) use (&$unsafeComment): string {
            if (str_starts_with($match[0], '/*') && (
                preg_match('~^/\*(?:[!+]|[mM]!)~', $match[0])
                || str_contains(substr($match[0], 2), '/*')
            )) {
                $unsafeComment = true;
            }

            // Keep an identifier marker so quoted function calls cannot hide a
            // mutating builtin. Quoted column/table names remain usable.
            return in_array($match[0][0], ['"', '`'], true) ? ' __turnkey_quoted_identifier__ ' : ' ';
        }, $query);

        if ($sql === null || $unsafeComment || strpbrk($sql, '$[]') !== false || preg_match('~[\'"`\\\\#]|/\*|--~', $sql)) {
            return false;
        }

        // Permit a single trailing terminator, never stacked SQL statements.
        $sql = preg_replace('/;\s*$/', '', trim($sql));

        if (str_contains($sql, ';') || ! preg_match('/^(SELECT|SHOW|DESCRIBE|DESC)\b/i', $sql)) {
            return false;
        }

        if (preg_match('/\b__turnkey_quoted_identifier__\s*\(|\bNEXT\s+VALUE\s+FOR\b/i', $sql)) {
            return false;
        }

        // SELECT INTO can write files/tables; write-locking reads and administrative or
        // procedural forms are intentionally refused. WITH/EXPLAIN fail closed too.
        return ! preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|UPSERT|INTO|OUTFILE|DUMPFILE|CREATE|ALTER|DROP|TRUNCATE|RENAME|CALL|EXEC|EXECUTE|GRANT|REVOKE|COPY|LOAD|LOCK|UNLOCK|SET|ATTACH|DETACH|VACUUM|PRAGMA|NEXTVAL|SETVAL|LO_IMPORT|LO_EXPORT|LO_UNLINK|DBLINK_EXEC|GET_LOCK|RELEASE_LOCK|LOAD_EXTENSION)\b|:=/i', $sql);
    }
}

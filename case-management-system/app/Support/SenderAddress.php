<?php

namespace App\Support;

use InvalidArgumentException;

final readonly class SenderAddress
{
    private const string QUOTED_STRING = '/"(?:[^"\\\\]++|\\\\.)*+"/s';

    public string $email;

    /**
     * @param  string  $email
     * @param  ?string  $name
     */
    public function __construct(
        string $email,
        public ?string $name,
    ) {
        $this->email = mb_strtolower(trim($email));
    }

    /**
     * @param  string  $header
     * @return self
     *
     * @throws InvalidArgumentException
     */
    public static function fromHeader(string $header): self
    {
        $trimmed = trim($header);
        $name = '';
        $comment = '';

        $angle = preg_match('/^(.*?)<([^<>]*)>(?:\s*\(([^()]*)\))?$/s', $trimmed, $matches);

        if ($angle === false) {
            throw self::invalid($header);
        }

        if ($angle === 1) {
            $name = trim($matches[1]);
            $address = trim($matches[2]);
            $comment = trim($matches[3] ?? '');
            $unquoted = preg_replace(self::QUOTED_STRING, '', $name);

            if ($unquoted === null || str_contains($unquoted, '<') || str_contains($unquoted, '>')) {
                throw self::invalid($header);
            }
        } else {
            $commentForm = preg_match('/^([^\s()<>]+)\s*\((.*)\)$/s', $trimmed, $matches);

            if ($commentForm === false) {
                throw self::invalid($header);
            }

            if ($commentForm === 1) {
                $address = $matches[1];
                $comment = trim($matches[2]);
            } else {
                $address = $trimmed;
            }
        }

        $hasSecondAddress = str_contains($name, '@') && (str_contains($name, ',') || str_contains($name, ';'));

        if ($hasSecondAddress || str_contains($comment, '@') || str_contains($comment, '<')) {
            throw self::invalid($header);
        }

        $address = trim($address);
        $hasWhitespace = preg_match('/\s/', $address);

        if ($hasWhitespace !== 0 || $address === '' || filter_var($address, FILTER_VALIDATE_EMAIL, FILTER_FLAG_EMAIL_UNICODE) === false) {
            throw self::invalid($header);
        }

        $quoted = preg_match('/^"(.*)"$/s', $name, $parts);

        if ($quoted === false) {
            throw self::invalid($header);
        }

        if ($quoted === 1) {
            $name = preg_replace('/\\\\(["\\\\])/', '$1', $parts[1]);

            if ($name === null) {
                throw self::invalid($header);
            }
        } elseif (str_starts_with($name, '"') && (substr_count($name, '"') - substr_count($name, '\\"')) % 2 === 1) {
            $name = substr($name, 1);
        }

        $name = trim(str_replace(["\r", "\n"], '', $name));

        if ($name === '') {
            $name = trim(str_replace(["\r", "\n"], '', $comment));
        }

        return new self(email: $address, name: $name === '' ? null : $name);
    }

    /**
     * @param  self  $other
     * @return bool
     */
    public function equals(self $other): bool
    {
        return $this->email === $other->email;
    }

    /**
     * @param  string  $header
     * @return InvalidArgumentException
     */
    private static function invalid(string $header): InvalidArgumentException
    {
        return new InvalidArgumentException('Sender header has no valid address: '.$header);
    }
}

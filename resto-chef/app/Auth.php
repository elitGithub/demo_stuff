<?php

declare(strict_types=1);

final class Auth
{
    public function __construct(private PDO $db)
    {
    }

    public function user(int $id): ?array
    {
        $q = $this->db->prepare('SELECT id,name,email,role FROM users WHERE id=?');
        $q->execute([$id]);
        return $q->fetch() ?: null;
    }

    public function register(string $name, string $email, string $password): array
    {
        $name = trim($name);
        $email = strtolower(trim($email));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
            throw new InvalidArgumentException('Enter a name between 2 and 100 characters.');
        }
        if (strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Enter a valid email address.');
        }
        if (strlen($password) < 12 || strlen($password) > 72) {
            throw new InvalidArgumentException('Use a password between 12 and 72 bytes.');
        }
        $q = $this->db->prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)');
        try {
            $q->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT), 'customer', time()]);
        } catch (PDOException $e) {
            if (in_array((string)$e->getCode(), ['23000', '23505'], true)) {
                throw new DomainException('Unable to register this email. Try signing in instead.');
            }
            throw $e;
        }
        return $this->user((int)$this->db->lastInsertId());
    }

    public function login(string $email, string $password, string $ip): ?array
    {
        $email = strtolower(trim($email));
        $buckets = [hash('sha256', 'email:' . $email) => 10, hash('sha256', 'ip:' . $ip) => 50];
        $cutoff = time() - 900;
        foreach ($buckets as $bucket => $limit) {
            $q = $this->db->prepare('SELECT failures FROM login_attempts WHERE bucket=? AND window_start>?');
            $q->execute([$bucket, $cutoff]);
            if ((int)$q->fetchColumn() >= $limit) {
                throw new DomainException('Too many sign-in attempts. Please try again in 15 minutes.');
            }
        }
        $q = $this->db->prepare('SELECT id,password_hash FROM users WHERE email=?');
        $q->execute([$email]);
        $row = $q->fetch();
        $dummy = '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        $valid = password_verify($password, $row ? $row['password_hash'] : $dummy);
        if (!$row || !$valid || strlen($password) > 72) {
            $mysql = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
            foreach ($buckets as $bucket => $limit) {
                $q = $this->db->prepare('DELETE FROM login_attempts WHERE bucket=? AND window_start<=?');
                $q->execute([$bucket, $cutoff]);
                $sql = $mysql
                    ? 'INSERT INTO login_attempts(bucket,failures,window_start) VALUES (?,1,?) ON DUPLICATE KEY UPDATE failures=failures+1'
                    : 'INSERT INTO login_attempts(bucket,failures,window_start) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET failures=failures+1';
                $this->db->prepare($sql)->execute([$bucket, time()]);
            }
            $this->db->prepare('DELETE FROM login_attempts WHERE window_start<?')->execute([time() - 86400]);
            return null;
        }
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            $this->db->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute(
                [password_hash($password, PASSWORD_DEFAULT), $row['id']]
            );
        }
        $this->db->prepare('DELETE FROM login_attempts WHERE bucket=?')->execute([hash('sha256', 'email:' . $email)]);
        return $this->user((int)$row['id']);
    }
}

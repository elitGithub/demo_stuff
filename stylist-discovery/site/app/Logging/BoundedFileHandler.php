<?php

namespace App\Logging;

use Monolog\Handler\AbstractProcessingHandler;
use Monolog\LogRecord;
use RuntimeException;

class BoundedFileHandler extends AbstractProcessingHandler
{
    /** @param LogRecord $record @return void */
    protected function write(LogRecord $record): void
    {
        $path = storage_path('logs/demo.log');
        $handle = fopen($path, 'c+');
        if ($handle === false || ! flock($handle, LOCK_EX)) {
            throw new RuntimeException('Cannot lock the private log.');
        }
        try {
            $message = substr((string) $record->formatted, 0, 1048576);
            $size = fstat($handle)['size'];
            if ($size + strlen($message) > 1048576) {
                rewind($handle);
                $previous = stream_get_contents($handle, 1048576);
                if ($previous === false || file_put_contents($path.'.1', $previous, LOCK_EX) === false || ! ftruncate($handle, 0)) {
                    throw new RuntimeException('Cannot rotate the private log.');
                }
            }
            fseek($handle, 0, SEEK_END);
            if (fwrite($handle, $message) !== strlen($message)) {
                throw new RuntimeException('Cannot write the private log.');
            }
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}

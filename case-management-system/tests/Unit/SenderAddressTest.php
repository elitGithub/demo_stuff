<?php

namespace Tests\Unit;

use App\Support\SenderAddress;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class SenderAddressTest extends TestCase
{
    /**
     * @return array<string, array{string, string, ?string}>
     */
    public static function headers(): array
    {
        return [
            'name and angle address' => ['Priya Nair <priya@mail.example>', 'priya@mail.example', 'Priya Nair'],
            'quoted name' => ['"Priya Nair" <priya@mail.example>', 'priya@mail.example', 'Priya Nair'],
            'quoted name with comma' => ['"Nair, Priya" <priya@mail.example>', 'priya@mail.example', 'Nair, Priya'],
            'bare address' => ['priya@mail.example', 'priya@mail.example', null],
            'bare angle address' => ['<priya@mail.example>', 'priya@mail.example', null],
            'surrounding whitespace' => ["  Priya Nair <priya@mail.example>\r\n", 'priya@mail.example', 'Priya Nair'],
            'whitespace in brackets' => ['Priya < priya@mail.example >', 'priya@mail.example', 'Priya'],
            'whitespace around bare address' => ['   priya@mail.example  ', 'priya@mail.example', null],
            'upper case address' => ['PRIYA@Mail.Example', 'priya@mail.example', null],
            'upper case in brackets keeps name case' => ['Priya NAIR <PRIYA@Mail.Example>', 'priya@mail.example', 'Priya NAIR'],
            'empty quoted name' => ['"" <priya@mail.example>', 'priya@mail.example', null],
            'comment form' => ['priya@mail.example (Priya Nair)', 'priya@mail.example', 'Priya Nair'],
            'escaped quote in name' => ['"Priya \"PN\" Nair" <priya@mail.example>', 'priya@mail.example', 'Priya "PN" Nair'],
            'escaped backslash in name' => ['"Priya \\\\ Nair" <priya@mail.example>', 'priya@mail.example', 'Priya \\ Nair'],
            'line breaks stripped from name' => ["\"Priya\r\n Nair\" <priya@mail.example>", 'priya@mail.example', 'Priya Nair'],
            'address-like display name' => ['priya@mail.example <priya@mail.example>', 'priya@mail.example', 'priya@mail.example'],
            'angle bracket inside quoted name' => ['"A <b>" <priya@mail.example>', 'priya@mail.example', 'A <b>'],
            'unquoted comma name' => ['Nair, Priya <p@m.example>', 'p@m.example', 'Nair, Priya'],
            'address as name' => ['p@m.example <p@m.example>', 'p@m.example', 'p@m.example'],
            'unbalanced quote' => ['"Priya <p@m.example>', 'p@m.example', 'Priya'],
            'trailing comment dropped' => ['Priya <p@m.example> (work)', 'p@m.example', 'Priya'],
            'inner quotes kept' => ['John "Johnny" <j@m.example>', 'j@m.example', 'John "Johnny"'],
            'leading quoted word kept' => ['"Priya" Nair <p@m.example>', 'p@m.example', '"Priya" Nair'],
            'comment names angle form without name' => ['<p@m.example> (Sam)', 'p@m.example', 'Sam'],
            'comment names bare form' => ['p@m.example (Sam)', 'p@m.example', 'Sam'],
            'comment ignored when name exists' => ['Priya <p@m.example> (work)', 'p@m.example', 'Priya'],
            'quoted comma name without at sign' => ['"Nair, Priya" <p@m.example>', 'p@m.example', 'Nair, Priya'],
            'unicode local part' => ['José <josé@mail.example>', 'josé@mail.example', 'José'],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidHeaders(): array
    {
        return [
            'empty angle' => ['<>'],
            'empty quotes' => ['""'],
            'whitespace only' => ['   '],
            'empty string' => [''],
            'name then bare address' => ['Priya Nair priya@mail.example'],
            'two addresses' => ['Priya <priya@mail.example>, Sam <sam@mail.example>'],
            'two bare addresses' => ['priya@mail.example, sam@mail.example'],
            'no domain' => ['Priya <priya>'],
            'whitespace inside address' => ['Priya <pri ya@mail.example>'],
            'bare first address then named second' => ['priya@mail.example, Sam <sam@mail.example>'],
            'address inside comment' => ['p@m.example (Sam <s@m.example>)'],
            'address in angle-form comment' => ['Priya <p@m.example> (Sam <s@m.example>)'],
            'at sign in comment' => ['p@m.example (sam@m.example)'],
            'semicolon separated addresses' => ['priya@mail.example; Sam <sam@mail.example>'],
            'quoted first address then named second' => ['"priya@mail.example", Sam <sam@mail.example>'],
            'comment on two addresses' => ['Priya <p@m.example>, Sam <s@m.example> (work)'],
        ];
    }

    /**
     * @return void
     */
    public function test_long_quoted_name_before_a_second_address_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        SenderAddress::fromHeader('"'.str_repeat('a', 20000).'" <a@m.example>, <b@m.example>');
    }

    /**
     * @return void
     */
    public function test_long_quoted_name_with_one_address_parses(): void
    {
        $name = str_repeat('a b ', 5000);
        $address = SenderAddress::fromHeader('"'.$name.'" <a@m.example>');

        $this->assertSame('a@m.example', $address->email);
        $this->assertSame(trim($name), $address->name);
    }

    /**
     * @return void
     */
    public function test_long_name_with_escapes_and_a_second_address_is_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        SenderAddress::fromHeader('"'.str_repeat('\\"x', 7000).'" <a@m.example>, Sam <b@m.example>');
    }

    /**
     * @param  string  $header
     * @return void
     */
    #[DataProvider('invalidHeaders')]
    public function test_from_header_rejects_headers_without_a_valid_address(string $header): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Sender header has no valid address: '.$header);

        SenderAddress::fromHeader($header);
    }

    /**
     * @return void
     */
    public function test_constructor_normalises_the_email(): void
    {
        $direct = new SenderAddress(email: ' PRIYA@Mail.Example ', name: null);

        $this->assertSame('priya@mail.example', $direct->email);
        $this->assertTrue($direct->equals(SenderAddress::fromHeader('Priya <priya@mail.example>')));
    }

    /**
     * @param  string  $header
     * @param  string  $email
     * @param  ?string  $name
     * @return void
     */
    #[DataProvider('headers')]
    public function test_from_header_parses_every_form(string $header, string $email, ?string $name): void
    {
        $address = SenderAddress::fromHeader($header);

        $this->assertSame($email, $address->email);
        $this->assertSame($name, $address->name);
    }

    /**
     * @return void
     */
    public function test_equals_ignores_name_and_case(): void
    {
        $first = SenderAddress::fromHeader('Priya Nair <priya@mail.example>');
        $second = SenderAddress::fromHeader('PRIYA@Mail.Example');

        $this->assertTrue($first->equals($second));
        $this->assertTrue($second->equals($first));
    }

    /**
     * @return void
     */
    public function test_equals_is_false_for_different_addresses(): void
    {
        $first = SenderAddress::fromHeader('Priya Nair <priya@mail.example>');
        $second = SenderAddress::fromHeader('Priya Nair <priya.nair@mail.example>');

        $this->assertFalse($first->equals($second));
    }
}

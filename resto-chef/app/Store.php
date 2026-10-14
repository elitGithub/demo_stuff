<?php
declare(strict_types=1);

final class Store
{
    public const STATUSES = ['pending'=>'New', 'preparing'=>'Preparing', 'ready'=>'Ready', 'out_for_delivery'=>'On the way', 'completed'=>'Completed', 'cancelled'=>'Cancelled'];
    public const IMAGES = ['bowl.jpg','bites.jpg','noodles.jpg','dosa.jpg','momos.jpg','platter.jpg'];
    public function __construct(private PDO $db, private int $deliveryFee = 350, private string $timezone = 'UTC', private ?Closure $clock = null) {}
    private function now(): int { return $this->clock ? ($this->clock)() : time(); }
    private function query(string $sql, array $params = []): PDOStatement { $q=$this->db->prepare($sql); $q->execute($params); return $q; }

    public function categories(): array { return $this->query('SELECT * FROM categories ORDER BY name')->fetchAll(); }
    public function menu(?int $category=null, string $search=''): array
    {
        $sql='SELECT f.*,c.name AS category FROM food f JOIN categories c ON c.id=f.category_id WHERE 1=1'; $params=[];
        if ($category) { $sql.=' AND f.category_id=?'; $params[]=$category; }
        if ($search !== '') { $sql.=' AND (f.name LIKE ? OR f.description LIKE ?)'; $params[]='%' . mb_substr($search,0,80) . '%'; $params[]=end($params); }
        return $this->query($sql.' ORDER BY f.available DESC,f.id', $params)->fetchAll();
    }
    public function food(int $id): ?array { return $this->query('SELECT * FROM food WHERE id=?',[$id])->fetch() ?: null; }
    public function saveCategory(string $name): void
    {
        $name=trim($name);
        if (mb_strlen($name)<2 || mb_strlen($name)>80) throw new InvalidArgumentException('Category names must be 2–80 characters.');
        try { $this->query('INSERT INTO categories(name) VALUES (?)',[$name]); }
        catch (PDOException $e) { if ((string)$e->getCode()==='23000') throw new DomainException('This category already exists.'); throw $e; }
    }
    public static function cents(string $value): int
    {
        if (!preg_match('/^\d{1,4}(?:\.\d{1,2})?$/', $value)) throw new InvalidArgumentException('Enter a price from 0.01 to 9999.99.');
        $parts=explode('.',$value); $cents=(int)$parts[0]*100+(int)str_pad($parts[1]??'',2,'0');
        if ($cents<1) throw new InvalidArgumentException('Price must be greater than zero.');
        return $cents;
    }
    public function saveFood(array $data, ?int $id=null): void
    {
        $name=trim($data['name']??''); $description=trim($data['description']??''); $tag=trim($data['tag']??'House favorite');
        if (mb_strlen($name)<2 || mb_strlen($name)>100 || mb_strlen($description)<5 || mb_strlen($description)>500 || mb_strlen($tag)>40) throw new InvalidArgumentException('Use a name (2–100 characters), description (5–500), and short label (up to 40).');
        $category=filter_var($data['category_id']??null,FILTER_VALIDATE_INT);
        if (!$category || !$this->query('SELECT id FROM categories WHERE id=?',[$category])->fetchColumn()) throw new InvalidArgumentException('Choose a valid category.');
        $image=$data['image']??'bowl.jpg';
        if (!in_array($image,self::IMAGES,true)) throw new InvalidArgumentException('Choose a menu photo.');
        $params=[$category,$name,$description,self::cents($data['price']??''),($data['available']??'')==='1'?1:0,$image,$tag];
        if ($id) {
            if (!$this->food($id)) throw new DomainException('Menu item no longer exists.');
            $params[]=$id;
            $this->query('UPDATE food SET category_id=?,name=?,description=?,price_cents=?,available=?,image=?,tag=? WHERE id=?',$params);
        } else $this->query('INSERT INTO food(category_id,name,description,price_cents,available,image,tag) VALUES (?,?,?,?,?,?,?)',$params);
    }
    public function setAvailability(int $id, bool $available): void
    {
        if (!$this->food($id)) throw new DomainException('Menu item no longer exists.');
        $this->query('UPDATE food SET available=? WHERE id=?',[$available?1:0,$id]);
    }
    public function cartLines(array $cart): array
    {
        $lines=[];
        foreach ($cart as $id=>$quantity) {
            $food=$this->food((int)$id) ?? ['id'=>$id,'name'=>'Removed menu item','price_cents'=>0,'available'=>0,'image'=>'bowl.jpg'];
            $food['quantity']=$quantity; $food['line_total_cents']=$food['price_cents']*$quantity; $lines[]=$food;
        }
        return $lines;
    }
    public function quote(array $cart, string $fulfillment, bool $lock=false): array
    {
        if (!in_array($fulfillment,['pickup','delivery'],true)) throw new InvalidArgumentException('Choose pickup or delivery.');
        if (!$cart || count($cart)>50) throw new InvalidArgumentException('Add items to your cart before checking out (maximum 50 different items).');
        ksort($cart); $items=[]; $subtotal=0; $count=0;
        foreach ($cart as $id=>$qty) {
            if (!is_int($qty) || $qty<1 || $qty>20 || !filter_var($id,FILTER_VALIDATE_INT) || (int)$id<1) throw new InvalidArgumentException('Choose a whole quantity between 1 and 20.');
            $sql='SELECT * FROM food WHERE id=?';
            if ($lock && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql') $sql.=' FOR UPDATE';
            $food=$this->query($sql,[(int)$id])->fetch();
            if (!$food || !(bool)$food['available']) throw new DomainException(($food['name']??'An item').' is currently unavailable. Please update your cart.');
            $items[]=['food_id'=>(int)$id,'name'=>$food['name'],'unit_price_cents'=>(int)$food['price_cents'],'quantity'=>$qty,'line_total_cents'=>(int)$food['price_cents']*$qty];
            $subtotal+=(int)$food['price_cents']*$qty; $count+=$qty;
        }
        if ($count>100) throw new InvalidArgumentException('Please limit an order to 100 items.');
        $fee=$fulfillment==='delivery'?$this->deliveryFee:0;
        return ['items'=>$items,'subtotal_cents'=>$subtotal,'delivery_fee_cents'=>$fee,'total_cents'=>$subtotal+$fee,'fingerprint'=>hash('sha256',json_encode([$items,$fulfillment,$fee],JSON_THROW_ON_ERROR))];
    }
    public function placeOrder(int $userId, array $cart, array $details, string $requestKey, string $expectedFingerprint): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/',$requestKey)) throw new InvalidArgumentException('Checkout expired. Please review your order again.');
        $existing=$this->query('SELECT * FROM orders WHERE request_key=?',[$requestKey])->fetch();
        if ($existing) {
            if ((int)$existing['user_id']!==$userId) throw new DomainException('Checkout expired. Please review your order again.');
            return $existing;
        }
        $name=trim($details['customer_name']??''); $phone=trim($details['phone']??''); $type=$details['fulfillment']??''; $address=trim($details['address']??''); $notes=trim($details['notes']??'');
        if (mb_strlen($name)<2 || mb_strlen($name)>100) throw new InvalidArgumentException('Enter the name for your order (2–100 characters).');
        if (!preg_match('/^[+0-9() .-]{7,30}$/',$phone) || strlen(preg_replace('/\D/','',$phone))<7) throw new InvalidArgumentException('Enter a valid contact phone number.');
        if ($type==='delivery' && (mb_strlen($address)<10 || mb_strlen($address)>500)) throw new InvalidArgumentException('Enter a delivery address (10–500 characters).');
        if (mb_strlen($notes)>500) throw new InvalidArgumentException('Order notes must be at most 500 characters.');
        if ($type==='pickup') $address='';
        // Reserve the SQLite writer before reading prices to avoid lock upgrades.
        $manualTransaction=$this->db->getAttribute(PDO::ATTR_DRIVER_NAME)==='sqlite';
        if($manualTransaction) $this->db->exec('BEGIN IMMEDIATE'); else $this->db->beginTransaction();
        $transactionOpen=true;
        try {
            $quote=$this->quote($cart,$type,true);
            if (!hash_equals($quote['fingerprint'],$expectedFingerprint)) throw new DomainException('Your cart or menu prices changed. Please review the updated total before ordering.');
            $now=$this->now(); $reference='RG-'.strtoupper(bin2hex(random_bytes(5)));
            $this->query('INSERT INTO orders(reference,request_key,user_id,customer_name,phone,fulfillment,address,notes,status,subtotal_cents,delivery_fee_cents,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[$reference,$requestKey,$userId,$name,$phone,$type,$address,$notes,'pending',$quote['subtotal_cents'],$quote['delivery_fee_cents'],$quote['total_cents'],$now,$now]);
            $orderId=(int)$this->db->lastInsertId();
            foreach ($quote['items'] as $item) $this->query('INSERT INTO order_items(order_id,food_id,name,unit_price_cents,quantity,line_total_cents) VALUES (?,?,?,?,?,?)',[$orderId,$item['food_id'],$item['name'],$item['unit_price_cents'],$item['quantity'],$item['line_total_cents']]);
            if($manualTransaction) $this->db->exec('COMMIT'); else $this->db->commit();
            $transactionOpen=false;
            return $this->query('SELECT * FROM orders WHERE id=?',[$orderId])->fetch();
        } catch (Throwable $e) {
            if($transactionOpen) {
                if($manualTransaction) $this->db->exec('ROLLBACK'); else $this->db->rollBack();
            }
            if ($e instanceof PDOException && (string)$e->getCode()==='23000') {
                $existing=$this->query('SELECT * FROM orders WHERE request_key=? AND user_id=?',[$requestKey,$userId])->fetch();
                if ($existing) return $existing;
            }
            throw $e;
        }
    }
    public function orderForUser(int $id, int $userId): ?array
    {
        $order=$this->query('SELECT * FROM orders WHERE id=? AND user_id=?',[$id,$userId])->fetch();
        return $order ? $this->withItems($order) : null;
    }
    private function withItems(array $order): array { $order['items']=$this->query('SELECT * FROM order_items WHERE order_id=? ORDER BY id',[$order['id']])->fetchAll(); return $order; }
    public function orders(?int $userId=null, string $status='all', int $page=1): array
    {
        $sql='SELECT * FROM orders WHERE 1=1'; $params=[];
        if ($userId!==null) { $sql.=' AND user_id=?'; $params[]=$userId; }
        if ($status==='active') $sql.=" AND status NOT IN ('completed','cancelled')";
        elseif (isset(self::STATUSES[$status])) { $sql.=' AND status=?'; $params[]=$status; }
        $offset=(max(1,min(10000,$page))-1)*20;
        $rows=$this->query($sql.' ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET '.$offset,$params)->fetchAll();
        return array_map(fn($row)=>$this->withItems($row),$rows);
    }
    public static function nextStatus(array $order): ?string
    {
        return match($order['status']) {
            'pending'=>'preparing','preparing'=>'ready','ready'=>$order['fulfillment']==='delivery'?'out_for_delivery':'completed','out_for_delivery'=>'completed',default=>null
        };
    }
    public function transition(int $id, string $expected, string $next): void
    {
        $order=$this->query('SELECT * FROM orders WHERE id=?',[$id])->fetch();
        if (!$order || $order['status']!==$expected) throw new DomainException('This order changed. Refresh and try again.');
        $allowed=self::nextStatus($order);
        if ($allowed===null || ($next!==$allowed && $next!=='cancelled')) throw new DomainException('That status change is not allowed.');
        $now=$this->now();
        $updated=$this->query('UPDATE orders SET status=?,updated_at=?,completed_at=? WHERE id=? AND status=?',[$next,$now,$next==='completed'?$now:null,$id,$expected]);
        if ($updated->rowCount()!==1) throw new DomainException('This order changed. Refresh and try again.');
    }
    public function sales(string $from, string $to): array
    {
        $zone=new DateTimeZone($this->timezone);
        $start=DateTimeImmutable::createFromFormat('!Y-m-d',$from,$zone); $end=DateTimeImmutable::createFromFormat('!Y-m-d',$to,$zone);
        if (!$start || !$end || $start->format('Y-m-d')!==$from || $end->format('Y-m-d')!==$to || $end<$start || $start->diff($end)->days>366) throw new InvalidArgumentException('Choose a valid date range of up to 367 days.');
        $bounds=[$start->getTimestamp(),$end->modify('+1 day')->getTimestamp()];
        $rows=$this->query("SELECT * FROM orders WHERE status='completed' AND completed_at>=? AND completed_at<? ORDER BY completed_at",$bounds)->fetchAll();
        $daily=[]; for($day=$start;$day<=$end;$day=$day->modify('+1 day')) $daily[$day->format('Y-m-d')]=['date'=>$day->format('Y-m-d'),'revenue_cents'=>0,'orders'=>0];
        $revenue=0; $fees=0;
        foreach ($rows as $row) {
            $key=(new DateTimeImmutable('@'.$row['completed_at']))->setTimezone($zone)->format('Y-m-d');
            $daily[$key]['revenue_cents']+=(int)$row['total_cents']; $daily[$key]['orders']++;
            $revenue+=(int)$row['total_cents']; $fees+=(int)$row['delivery_fee_cents'];
        }
        $popular=$this->query("SELECT i.name,SUM(i.quantity) AS quantity,SUM(i.line_total_cents) AS revenue_cents FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='completed' AND o.completed_at>=? AND o.completed_at<? GROUP BY i.name ORDER BY quantity DESC,i.name LIMIT 5",$bounds)->fetchAll();
        foreach ($popular as &$item) { $item['quantity']=(int)$item['quantity']; $item['revenue_cents']=(int)$item['revenue_cents']; } unset($item);
        $active=(int)$this->query("SELECT COUNT(*) FROM orders WHERE status NOT IN ('completed','cancelled')")->fetchColumn();
        $cancelled=(int)$this->query("SELECT COUNT(*) FROM orders WHERE status='cancelled' AND updated_at>=? AND updated_at<?",$bounds)->fetchColumn();
        return ['revenue_cents'=>$revenue,'delivery_fees_cents'=>$fees,'completed_count'=>count($rows),'average_cents'=>count($rows)?(int)round($revenue/count($rows)):0,'active_count'=>$active,'cancelled_count'=>$cancelled,'daily'=>array_values($daily),'popular'=>$popular];
    }
}

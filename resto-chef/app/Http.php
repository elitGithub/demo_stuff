<?php
declare(strict_types=1);

final class Http
{
    public function run(string $path, string $method): void
    {
        global $store,$auth,$config,$user;
        $postRoutes=['/cart/add','/cart/update','/checkout','/login','/register','/logout','/admin/menu/save','/admin/menu/availability','/admin/categories','/admin/orders/status'];
        $getRoutes=['/','/menu','/cart','/checkout','/login','/register','/orders','/admin','/admin/orders','/admin/menu','/admin/menu/edit'];
        $orderDetail=preg_match('~^/orders/([1-9][0-9]*)$~D',$path,$match)===1;
        if(!in_array($method,['GET','POST'],true)) { header('Allow: GET, POST'); fail(405,'This request method is not supported.'); }
        if($method==='GET' && in_array($path,$postRoutes,true) && !in_array($path,$getRoutes,true)) { header('Allow: POST'); fail(405,'Use the form to make this change.'); }
        if($method==='POST' && !in_array($path,$postRoutes,true)) fail(404,'This page could not be found.');
        if($method==='GET' && !in_array($path,$getRoutes,true) && !$orderDetail) fail(404,'This page could not be found.');
        if($method==='POST') {
            $token=$_POST['_csrf']??null;
            if(!is_string($token) || !hash_equals($_SESSION['_csrf'],$token)) fail(419,'Your form expired. Refresh this page and try again.');
        }
        if(str_starts_with($path,'/admin')) requireAdmin();
        if($method==='POST') {
            try { $this->post($path); }
            catch(InvalidArgumentException|DomainException $e) {
                flash($e->getMessage(),'error');
                if($path==='/checkout') {
                    $_SESSION['checkout_old']=array_intersect_key($_POST,array_flip(['customer_name','phone','address','notes']));
                    $type=$_POST['fulfillment']??null;
                    redirect('/checkout?fulfillment='.(is_string($type) && in_array($type,['pickup','delivery'],true)?$type:'pickup'));
                }
                if($path==='/admin/menu/save') {
                    // Preserve the entire form on validation errors, without mutating data.
                    $id=filter_var($_POST['food_id']??'',FILTER_VALIDATE_INT);
                    $_SESSION['food_old']=$_POST;
                    redirect('/admin/menu/edit'.($id?'?id='.$id:''));
                }
                $target=match($path){'/login'=>'/login','/register'=>'/register','/admin/menu/availability','/admin/categories'=>'/admin/menu','/admin/orders/status'=>'/admin/orders',default=>'/cart'};
                redirect($target);
            }
            return;
        }
        if($path==='/' || $path==='/menu') {
            $category=filter_var(queryField('category'),FILTER_VALIDATE_INT)?:null;
            render('menu',['title'=>'Made fresh. Made for you.','foods'=>$store->menu($category,queryField('q')),'categories'=>$store->categories(),'category'=>$category,'search'=>queryField('q')]);
        } elseif($path==='/cart') {
            render('cart',['title'=>'Your bag','lines'=>$store->cartLines($_SESSION['cart']??[])]);
        } elseif($path==='/login' || $path==='/register') {
            if($user) redirect($user['role']==='admin'?'/admin':'/menu');
            render('auth',['title'=>$path==='/login'?'Welcome back':'A seat at our table','register'=>$path==='/register']);
        } elseif($path==='/checkout') {
            requireLogin();
            $type=queryField('fulfillment','pickup');
            try { $quote=$store->quote($_SESSION['cart']??[],$type); }
            catch(InvalidArgumentException|DomainException $e) { flash($e->getMessage(),'error'); redirect('/cart'); }
            $key=bin2hex(random_bytes(32));
            $_SESSION['checkout_quotes']??=[];
            $_SESSION['checkout_quotes'][$key]=['fingerprint'=>$quote['fingerprint'],'type'=>$type,'created'=>time()];
            $_SESSION['checkout_quotes']=array_slice($_SESSION['checkout_quotes'],-10,null,true);
            $old=$_SESSION['checkout_old']??[]; unset($_SESSION['checkout_old']);
            render('checkout',['title'=>'Make it yours','quote'=>$quote,'type'=>$type,'checkoutKey'=>$key,'old'=>$old]);
        } elseif($path==='/orders') {
            requireLogin(); $page=max(1,(int)queryField('page','1'));
            render('orders',['title'=>'Your orders','orders'=>$store->orders($user['id'],'all',$page),'page'=>$page]);
        } elseif($orderDetail) {
            requireLogin(); $order=$store->orderForUser((int)$match[1],$user['id']);
            if(!$order) fail(404,'That order could not be found.');
            render('order',['title'=>'Your order','order'=>$order]);
        } elseif($path==='/admin') {
            $today=displayTime(time(),'Y-m-d'); $from=queryField('from',displayTime(time()-6*86400,'Y-m-d')); $to=queryField('to',$today);
            try { $report=$store->sales($from,$to); }
            catch(InvalidArgumentException $e) { flash($e->getMessage(),'error'); redirect('/admin'); }
            render('dashboard',['title'=>'Overview','staff'=>true,'report'=>$report,'from'=>$from,'to'=>$to,'today'=>$today]);
        } elseif($path==='/admin/orders') {
            $status=queryField('status','active'); if(!isset(Store::STATUSES[$status]) && !in_array($status,['active','all'],true)) $status='active';
            $page=max(1,(int)queryField('page','1'));
            render('kitchen',['title'=>'Order desk','staff'=>true,'orders'=>$store->orders(null,$status,$page),'status'=>$status,'page'=>$page]);
        } elseif($path==='/admin/menu') {
            render('admin-menu',['title'=>'Your menu','staff'=>true,'foods'=>$store->menu(),'categories'=>$store->categories()]);
        } elseif($path==='/admin/menu/edit') {
            $id=filter_var(queryField('id'),FILTER_VALIDATE_INT)?:null; $food=$id?$store->food($id):null;
            if($id && !$food) fail(404,'This menu item could not be found.');
            $old=$_SESSION['food_old']??[]; unset($_SESSION['food_old']);
            render('food-form',['title'=>$food?'Edit dish':'Add a dish','staff'=>true,'food'=>$food,'categories'=>$store->categories(),'old'=>$old]);
        }
    }

    private function post(string $path): never
    {
        global $store,$auth,$user;
        if($path==='/login') {
            $account=$auth->login(field('email'),field('password'),$_SERVER['REMOTE_ADDR']??'unknown');
            if(!$account) throw new DomainException('Email or password is incorrect.');
            signIn($account); redirect($account['role']==='admin'?'/admin':(cartCount()?'/cart':'/menu'));
        }
        if($path==='/register') {
            $account=$auth->register(field('name'),field('email'),field('password'));
            signIn($account); flash('Welcome! Your table is ready.'); redirect(cartCount()?'/cart':'/menu');
        }
        if($path==='/logout') {
            $_SESSION=[]; session_regenerate_id(true); $_SESSION['_csrf']=bin2hex(random_bytes(32));
            flash('You have signed out.'); redirect('/');
        }
        if($path==='/cart/add') {
            $id=positiveId('food_id'); $qty=filter_var(field('quantity','1'),FILTER_VALIDATE_INT);
            if($qty===false || $qty<1 || $qty>20) throw new InvalidArgumentException('Choose a quantity between 1 and 20.');
            $cart=$_SESSION['cart']??[]; $cart[$id]=($cart[$id]??0)+$qty;
            $store->quote($cart,'pickup'); $_SESSION['cart']=$cart;
            flash('Added to your bag.'); redirect(field('return_to')==='menu'?'/menu':'/cart');
        }
        if($path==='/cart/update') {
            $id=positiveId('food_id'); $qty=filter_var(field('quantity'),FILTER_VALIDATE_INT);
            if($qty===false || $qty<0 || $qty>20) throw new InvalidArgumentException('Choose a quantity from 0 to 20.');
            $cart=$_SESSION['cart']??[];
            if(!isset($cart[$id])) throw new DomainException('That item is no longer in your bag.');
            if($qty===0) unset($cart[$id]); else $cart[$id]=$qty;
            // Removing a sold-out item must work even when another item is unavailable.
            $_SESSION['cart']=$cart; flash($qty===0?'Item removed.':'Quantity updated.'); redirect('/cart');
        }
        if($path==='/checkout') {
            requireLogin(); $key=field('checkout_key'); $saved=$_SESSION['checkout_quotes'][$key]??null;
            if(isset($saved['order_id']) && $store->orderForUser((int)$saved['order_id'],$user['id'])) redirect('/orders/'.(int)$saved['order_id']);
            if(!$saved || time()-$saved['created']>3600 || field('fulfillment')!==$saved['type']) throw new DomainException('Checkout expired. Please review your order again.');
            $details=[]; foreach(['fulfillment','customer_name','phone','address','notes'] as $name) $details[$name]=field($name);
            $order=$store->placeOrder($user['id'],$_SESSION['cart']??[],$details,$key,$saved['fingerprint']);
            $_SESSION['checkout_quotes'][$key]['order_id']=$order['id'];
            $_SESSION['cart']=[]; unset($_SESSION['checkout_old']);
            flash('Order received! The kitchen will take it from here.'); redirect('/orders/'.$order['id']);
        }
        if($path==='/admin/menu/save') {
            $data=[]; foreach(['name','description','category_id','price','available','image','tag'] as $name) $data[$name]=field($name);
            $id=field('food_id')!==''?positiveId('food_id'):null;
            $store->saveFood($data,$id); unset($_SESSION['food_old']); flash($id?'Dish updated.':'New dish added.'); redirect('/admin/menu');
        }
        if($path==='/admin/menu/availability') {
            $available=field('available'); if(!in_array($available,['0','1'],true)) throw new InvalidArgumentException('Choose a valid availability.');
            $store->setAvailability(positiveId('food_id'),$available==='1'); flash('Availability updated.'); redirect('/admin/menu');
        }
        if($path==='/admin/categories') { $store->saveCategory(field('name')); flash('Category added.'); redirect('/admin/menu'); }
        if($path==='/admin/orders/status') {
            $store->transition(positiveId('order_id'),field('expected_status'),field('status')); flash('Order status updated.'); redirect('/admin/orders?status=all');
        }
        fail(404,'This action could not be found.');
    }
}

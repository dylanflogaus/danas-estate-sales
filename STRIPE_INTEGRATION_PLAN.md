Here's a comprehensive plan file you can share with Cursor AI. Save this as `STRIPE_INTEGRATION_PLAN.md` in your project root.

---

# Stripe Cart Integration Plan for Cloudflare Pages

## Project Overview

Build a fully functional e-commerce website on Cloudflare Pages with:
- **Dynamic product management** (no Stripe Dashboard needed for products)
- **Shopping cart** (add/remove items)
- **Stripe Checkout integration** using `price_data` method
- **Admin dashboard** to manage products (CRUD operations)

### Tech Stack
| Component | Technology |
|-----------|------------|
| Frontend | React + TailwindCSS |
| Backend API | Cloudflare Workers (Hono) |
| Database | Cloudflare D1 (SQLite) |
| Payments | Stripe Checkout |
| Hosting | Cloudflare Pages |
| Auth (optional) | Cloudflare Zero Trust / Turnstile |

---

## Database Schema (Cloudflare D1)

```sql
-- Products table (YOUR source of truth)
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,  -- in cents (e.g., 1999 = $19.99)
    image_url TEXT,
    inventory INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders table (to track Stripe checkouts)
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_session_id TEXT UNIQUE,
    customer_email TEXT,
    total_amount INTEGER,
    status TEXT DEFAULT 'pending',  -- pending, paid, failed, refunded
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Order items (line items from cart)
CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    product_name TEXT,
    quantity INTEGER,
    unit_price INTEGER,
    FOREIGN KEY(order_id) REFERENCES orders(id)
);

-- Sessions (for admin dashboard auth - optional)
CREATE TABLE admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    expires_at DATETIME
);
```

---

## Project Structure

```
my-ecommerce-site/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ProductCard.jsx
│   │   │   ├── CartDrawer.jsx
│   │   │   └── CheckoutButton.jsx
│   │   ├── pages/
│   │   │   ├── Shop.jsx
│   │   │   ├── Cart.jsx
│   │   │   ├── Success.jsx
│   │   │   ├── Cancel.jsx
│   │   │   └── Admin/
│   │   │       ├── Dashboard.jsx
│   │   │       ├── ProductList.jsx
│   │   │       ├── ProductForm.jsx
│   │   │       └── Orders.jsx
│   │   ├── hooks/
│   │   │   ├── useCart.js
│   │   │   └── useProducts.js
│   │   ├── utils/
│   │   │   └── stripe.js
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── functions/
│   │   ├── api/
│   │   │   ├── products.js      (GET, POST, PUT, DELETE)
│   │   │   ├── cart.js           (create checkout session)
│   │   │   ├── webhook.js        (Stripe webhook endpoint)
│   │   │   └── admin/
│   │   │       ├── auth.js
│   │   │       └── orders.js
│   │   └── _middleware.js
│   ├── db/
│   │   └── schema.sql
│   └── package.json
├── wrangler.toml
├── .env
└── package.json
```

---

## Cloudflare Setup Instructions

### 1. Initialize Project

```bash
# Create new Cloudflare Pages project with Workers
npm create cloudflare@latest my-ecommerce-site -- --framework=react
cd my-ecommerce-site

# Install dependencies
npm install @cloudflare/workers-types stripe hono drizzle-orm
npm install -D wrangler tailwindcss @tailwindcss/vite
```

### 2. Configure `wrangler.toml`

```toml
name = "my-ecommerce-site"
main = "backend/index.js"
compatibility_date = "2024-12-18"

[[d1_databases]]
binding = "DB"
database_name = "ecommerce-db"
database_id = "your-d1-database-id"

[vars]
STRIPE_SECRET_KEY = "sk_live_..."  # Use secrets for production

[[env.production.vars]]
STRIPE_WEBHOOK_SECRET = "whsec_..."

[env.production.secrets]
STRIPE_SECRET_KEY = "sk_live_..."
```

### 3. Create D1 Database

```bash
# Create database
npx wrangler d1 create ecommerce-db

# Run migrations
npx wrangler d1 execute ecommerce-db --file=./backend/db/schema.sql

# Create binding (copy the output to wrangler.toml)
npx wrangler d1 execute ecommerce-db --command "SELECT 1"
```

---

## Backend API Endpoints (Cloudflare Workers)

### `api/products.js` - Product Management

```javascript
// GET /api/products - List all active products
// POST /api/admin/products - Create new product (admin)
// PUT /api/admin/products/:id - Update product (admin)
// DELETE /api/admin/products/:id - Delete product (admin)

export async function onRequest(context) {
    const { request, env } = context;
    
    if (request.method === 'GET') {
        const { results } = await env.DB.prepare(
            "SELECT * FROM products WHERE is_active = 1 ORDER BY id DESC"
        ).all();
        
        return Response.json({ products: results });
    }
    
    // POST, PUT, DELETE require admin auth token in header
    // ... implementation details
}
```

### `api/cart.js` - Create Checkout Session

```javascript
import Stripe from 'stripe';

export async function onRequest(context) {
    const { request, env } = context;
    const { cartItems, successUrl, cancelUrl } = await request.json();
    
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    
    // Build line_items dynamically from cart
    const lineItems = cartItems.map(item => ({
        price_data: {
            currency: 'usd',
            product_data: {
                name: item.name,
                description: item.description,
                metadata: {
                    product_id: item.id,
                    // Your internal reference
                }
            },
            unit_amount: item.price,  // Already in cents
        },
        quantity: item.quantity,
    }));
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
        line_items: lineItems,
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            // Optional: store cart snapshot
        }
    });
    
    // Store session in D1 for tracking
    await env.DB.prepare(
        "INSERT INTO orders (stripe_session_id, total_amount, status) VALUES (?, ?, 'pending')"
    ).bind(session.id, cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0))
    .run();
    
    return Response.json({ sessionId: session.id, url: session.url });
}
```

### `api/webhook.js` - Stripe Webhook Handler

```javascript
export async function onRequest(context) {
    const { request, env } = context;
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');
    
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
    
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Update order status in D1
        await env.DB.prepare(
            "UPDATE orders SET status = 'paid', customer_email = ? WHERE stripe_session_id = ?"
        ).bind(session.customer_email, session.id).run();
        
        // Optional: Send confirmation email, update inventory, etc.
    }
    
    return new Response('Webhook received', { status: 200 });
}
```

---

## Frontend Implementation

### `hooks/useCart.js` - Cart State Management

```javascript
import { useState, useEffect } from 'react';

export function useCart() {
    const [cart, setCart] = useState([]);
    
    // Load cart from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('cart');
        if (saved) setCart(JSON.parse(saved));
    }, []);
    
    // Save to localStorage whenever cart changes
    useEffect(() => {
        localStorage.setItem('cart', JSON.stringify(cart));
    }, [cart]);
    
    const addToCart = (product, quantity = 1) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.id === product.id
                        ? { ...item, quantity: item.quantity + quantity }
                        : item
                );
            }
            return [...prev, { ...product, quantity }];
        });
    };
    
    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };
    
    const updateQuantity = (productId, quantity) => {
        if (quantity <= 0) {
            removeFromCart(productId);
            return;
        }
        setCart(prev =>
            prev.map(item =>
                item.id === productId ? { ...item, quantity } : item
            )
        );
    };
    
    const clearCart = () => setCart([]);
    
    const getCartTotal = () => {
        return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    };
    
    return {
        cart,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        getCartTotal,
        itemCount: cart.reduce((sum, item) => sum + item.quantity, 0)
    };
}
```

### `components/ProductCard.jsx`

```jsx
export function ProductCard({ product, onAddToCart }) {
    return (
        <div className="border rounded-lg p-4 shadow-sm">
            {product.image_url && (
                <img 
                    src={product.image_url} 
                    alt={product.name}
                    className="w-full h-48 object-cover rounded"
                />
            )}
            <h3 className="text-lg font-semibold mt-2">{product.name}</h3>
            <p className="text-gray-600 text-sm">{product.description}</p>
            <p className="text-xl font-bold mt-2">
                ${(product.price / 100).toFixed(2)}
            </p>
            <button
                onClick={() => onAddToCart(product)}
                disabled={product.inventory === 0}
                className="mt-3 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
                {product.inventory > 0 ? 'Add to Cart' : 'Sold Out'}
            </button>
        </div>
    );
}
```

### `pages/Admin/Dashboard.jsx` - Admin Product Management

```jsx
import { useState, useEffect } from 'react';

export default function AdminDashboard() {
    const [products, setProducts] = useState([]);
    const [editingProduct, setEditingProduct] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        price: '',
        inventory: '',
        image_url: ''
    });
    
    // Fetch products (including inactive)
    useEffect(() => {
        fetch('/api/admin/products', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
        })
            .then(res => res.json())
            .then(data => setProducts(data.products));
    }, []);
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        const productData = {
            ...formData,
            price: Math.round(parseFloat(formData.price) * 100) // Convert to cents
        };
        
        const url = editingProduct 
            ? `/api/admin/products/${editingProduct.id}`
            : '/api/admin/products';
        
        const method = editingProduct ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(productData)
        });
        
        if (response.ok) {
            // Refresh product list
            setEditingProduct(null);
            setFormData({ name: '', description: '', price: '', inventory: '', image_url: '' });
            // Refetch products...
        }
    };
    
    const handleDelete = async (productId) => {
        if (confirm('Delete this product?')) {
            await fetch(`/api/admin/products/${productId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
            });
            // Refresh list
        }
    };
    
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Product Management</h1>
            
            {/* Product Form */}
            <form onSubmit={handleSubmit} className="bg-gray-100 p-4 rounded mb-8">
                <h2 className="text-xl mb-4">{editingProduct ? 'Edit' : 'Add'} Product</h2>
                <div className="grid grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Product Name"
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="p-2 border rounded"
                        required
                    />
                    <input
                        type="text"
                        placeholder="Price (USD)"
                        value={formData.price}
                        onChange={e => setFormData({...formData, price: e.target.value})}
                        className="p-2 border rounded"
                        required
                    />
                    <input
                        type="number"
                        placeholder="Inventory"
                        value={formData.inventory}
                        onChange={e => setFormData({...formData, inventory: e.target.value})}
                        className="p-2 border rounded"
                    />
                    <input
                        type="url"
                        placeholder="Image URL"
                        value={formData.image_url}
                        onChange={e => setFormData({...formData, image_url: e.target.value})}
                        className="p-2 border rounded"
                    />
                    <textarea
                        placeholder="Description"
                        value={formData.description}
                        onChange={e => setFormData({...formData, description: e.target.value})}
                        className="p-2 border rounded col-span-2"
                        rows="3"
                    />
                </div>
                <div className="mt-4 flex gap-2">
                    <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded">
                        {editingProduct ? 'Update' : 'Create'} Product
                    </button>
                    {editingProduct && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingProduct(null);
                                setFormData({ name: '', description: '', price: '', inventory: '', image_url: '' });
                            }}
                            className="bg-gray-500 text-white px-4 py-2 rounded"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </form>
            
            {/* Product List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map(product => (
                    <div key={product.id} className="border rounded p-4">
                        <h3 className="font-semibold">{product.name}</h3>
                        <p className="text-sm text-gray-600">${(product.price / 100).toFixed(2)}</p>
                        <p className="text-sm">Stock: {product.inventory}</p>
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={() => {
                                    setEditingProduct(product);
                                    setFormData({
                                        name: product.name,
                                        description: product.description,
                                        price: (product.price / 100).toString(),
                                        inventory: product.inventory,
                                        image_url: product.image_url || ''
                                    });
                                }}
                                className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => handleDelete(product.id)}
                                className="bg-red-600 text-white px-3 py-1 rounded text-sm"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
```

---

## Environment Variables (.env)

```env
# Stripe Keys
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token

# Admin Dashboard (optional - use Cloudflare Access instead)
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=bcrypt_hash_here
```

---

## Deployment Steps

### 1. Local Development

```bash
# Install dependencies
npm install

# Run D1 migrations locally
npx wrangler d1 execute ecommerce-db --local --file=./backend/db/schema.sql

# Start dev server
npm run dev
```

### 2. Stripe Webhook Setup

```bash
# Use Stripe CLI to forward webhooks locally
stripe listen --forward-to localhost:8787/api/webhook

# For production, set webhook endpoint in Stripe Dashboard
# Endpoint: https://your-site.pages.dev/api/webhook
```

### 3. Deploy to Cloudflare Pages

```bash
# Build and deploy
npm run build
npx wrangler pages deploy ./dist --project-name=my-ecommerce-site

# Bind D1 to Pages project
npx wrangler pages deployment list
npx wrangler d1 bind ecommerce-db --project-name=my-ecommerce-site
```

### 4. Set Secrets in Production

```bash
# Set Stripe secret key (production)
npx wrangler secret put STRIPE_SECRET_KEY --env production

# Set webhook secret
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
```

---

## Key Features Summary

| Feature | Implementation |
|---------|----------------|
| Add/remove products | Admin dashboard updates D1 directly |
| No Stripe product config | `price_data` in checkout session |
| Persistent cart | localStorage + D1 order storage |
| Payment methods | Activated in Stripe Dashboard, auto-shown by Checkout |
| Inventory tracking | D1 products table, decrement on successful webhook |
| Order management | D1 orders + order_items tables |

---

## Next Steps for Cursor AI

1. **Generate full code** for each file above based on this plan
2. **Add authentication** to admin dashboard (Cloudflare Access recommended)
3. **Implement inventory decrement** in the webhook handler after successful payment
4. **Add email notifications** using a service like Resend or Courier
5. **Set up proper error handling** and retry logic for webhooks
6. **Add a success page** that displays order details using the session ID from URL

---

## Useful Commands

```bash
# D1 database management
npx wrangler d1 execute ecommerce-db --command "SELECT * FROM products"
npx wrangler d1 execute ecommerce-db --file=./migrations/001_add_indexes.sql

# Tail logs
npx wrangler pages deployment tail

# Stripe CLI testing
stripe trigger checkout.session.completed
```

---

This plan gives you a complete, working e-commerce site on Cloudflare Pages where you manage products entirely through your own dashboard, never touching Stripe for product configuration. Share this file with Cursor AI and it can generate all the actual code files.

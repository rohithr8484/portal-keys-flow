
CREATE TABLE public.payment_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  token TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  expiry TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payment_requests TO anon, authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read payment requests" ON public.payment_requests FOR SELECT USING (true);
CREATE POLICY "Anyone can create payment requests" ON public.payment_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update payment requests" ON public.payment_requests FOR UPDATE USING (true) WITH CHECK (true);

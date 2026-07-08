
DROP POLICY IF EXISTS "Anyone can update payment requests" ON public.payment_requests;
CREATE POLICY "Anyone can update pending requests" ON public.payment_requests
  FOR UPDATE USING (status = 'pending') WITH CHECK (status IN ('pending','paid','cancelled','expired'));

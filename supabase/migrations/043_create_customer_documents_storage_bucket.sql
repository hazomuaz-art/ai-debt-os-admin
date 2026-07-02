insert into storage.buckets (id, name, public)
values ('customer-documents', 'customer-documents', false)
on conflict (id) do nothing;

create policy "service_role_all_customer_documents_storage"
on storage.objects for all
using (bucket_id = 'customer-documents' and auth.role() = 'service_role')
with check (bucket_id = 'customer-documents' and auth.role() = 'service_role');

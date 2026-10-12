-- BACKEND-FIRST: add the sixth server category without rewriting the original
-- eleven DRAFT products or approving/publishing any catalog. ETF selection,
-- source references and visual integration remain separate operator decisions.
-- Commit this enum addition before using ETF in a later data transaction.
alter type public.product_category add value if not exists 'ETF';

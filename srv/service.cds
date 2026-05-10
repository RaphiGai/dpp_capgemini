using test.demo as db from '../db/schema';

service CatalogService @(
  path     : '/odata/v4/catalog',
  requires : 'authenticated-user'
) {

  @readonly
  entity Products as projection on db.Products;

}

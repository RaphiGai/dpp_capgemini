namespace test.demo;

using { cuid, managed } from '@sap/cds/common';

entity Products : cuid, managed {
  name        : String(100) not null;
  description : String(500);
  category    : String(50);
  price       : Decimal(9,2);
  currency    : String(3) default 'EUR';
  stock       : Integer default 0;
}

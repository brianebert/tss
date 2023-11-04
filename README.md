# @brianebert/tss
a way (tao) to safely and simply to use ipfs distributd storage, with distributed message queueing, end to end encryption and micropayments.

tss encrypts your data with keys derived from your crypto wallet wallet signature, allowing you to safely store it in a public ipfs network.

tss maintains relations between blocks of data by backlinking ipld dags and rippling hash changes from leaf node to graph root, using a simple insert(), modify(), and delete() programmer's api.

## Install

1. Add tss to your project using npm:

```shell
npm i tss --save
```

2. require/import it in your JavaScript:

```js
import { COL_Node, SigningAccount } from "@brianebert/tss";
```
## Test tss

1. Use @brianebert/ttss
```shell
git clone https://github.com/brianebert/ttss.git && cd ttss
```
# @brianebert/tss
a way (tao) to safely and simply to use ipfs

safely because by default tss encrypts data before loading it into ipfs

simply because you can link ipfs addresses together in javascript and tss\
maintains the links as changes ripple from leaf nodes to roots

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
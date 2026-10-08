# clawd-wander: /config で時間を変えられるようにする

居眠りするまでの時間と、道具を使い終えてからしまうまでの時間を、`/config` から変えられるようにする。
これまではコードに固定していた（居眠り 60 秒、道具 10 秒）。

**Status:** done（2026-10-08。テストで確認。vhs の録画で、/config に 2 項目が出ること、doze_seconds=3・prop_seconds=2 で Read の約 2 秒後に道具をしまい約 3 秒後に居眠りすることを確認）
**Blocked by:** なし

## 要件

1 コマ = 100 ms。秒数は四捨五入してコマ数にする。

```text
R1  [WHERE] userConfig の doze_seconds がある場合、帯は「いる」1 体の活動がその秒数途切れたら居眠りさせる（.scratch/emotes/spec.md の R5 の 60 秒を置き換える）。
R2  [WHERE] userConfig の prop_seconds がある場合、帯は道具を使い終えてからその秒数で道具をしまう（.scratch/props/spec.md の R11 の 10 秒を置き換える）。
R3  [IF]    doze_seconds・prop_seconds が 1 以上 3600 以下の数でない場合、帯はその項目に既定値（60・10）を使う。
R4  [KEEP]  どちらも設定しなければ、帯は引き続き 60 秒で居眠りし、10 秒で道具をしまう。
R5  [WHERE] userConfig の surf が false の場合、帯は波乗りしない（既定はオン。.scratch/surf/spec.md の R12。2026-10-08 に追加）。
```

`/config` で値を変えると、エンジンがモジュールを読み直す（plugin-authoring の reference.md）。そのとき帯の顔ぶれは作り直される。

## 契約

```text
契約: Timing（crew.ts）
- 値: { dozeFrames: number; propFrames: number }。どちらもコマ数
- DEFAULT_TIMING = { dozeFrames: DOZE_FRAMES（600）, propFrames: PROP_FRAMES（100） }

契約: timingOf(options)（crew.ts）
- 事前: options はプラグインの設定（PluginOptions）
- 事後: doze_seconds・prop_seconds を R3 のとおり検めてコマ数にした Timing
- 不変: options を変更しない

契約: 居眠りを決める関数（lineUp・advance・sync・join・actors）と、道具を持たせる関数（wield・release）
- 最後の引数に timing（既定 DEFAULT_TIMING）を取る。ほかの振る舞いは変えない
```

## テストとの対応

- [x] R1: 居眠りまでのコマ数を timing で渡すと、そのコマ数で居眠りする（純関数）
- [x] R2・register: prop_seconds = 3 なら、道具を使い終えてから 3 秒でしまう
- [x] R3: 範囲外・数でない値は既定値になる（timingOf）
- [x] R4: 既存のテスト（居眠り 60 秒・道具 10 秒）が設定なしのまま通る

## 記録（2026-10-08）

- 決めたこと: 時間を Timing という値にまとめ、居眠りと道具を決める関数に引数で渡す（既定値つき）。
  採らなかった案は、モジュールの変数に設定を置く形（テストどうしで設定が漏れる、グローバル状態）と、
  1 体ごとに「居眠り中か」を持たせる形（`idle` と二重になり食い違いうる）
- 最低表示時間（1.5 秒。props の R23）は設定に出さない（変えたい理由がまだ無い）

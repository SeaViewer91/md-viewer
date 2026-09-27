# MD Viewer에 오신 것을 환영합니다

왼쪽 **파일** 탭에서 폴더를 열고(`⌘/Ctrl + O`), 가운데에서 편집하면 오른쪽 **미리보기**가 바로 갱신됩니다.
이 문서는 저장되지 않은 연습용 문서입니다. 자유롭게 고쳐 보세요.

> [!TIP] 자주 쓰는 단축키
> `⌘S` 저장 · `⌘W` 탭 닫기 · `⌘E` 읽기 모드 · `⌘F` 찾기 · `⌘⇧F` 목차 · `⌘P` 인쇄/PDF · `⌘,` 설정 · `⇧⌥F` 표 정렬
> 미리보기를 **더블클릭**하면 편집기가 그 줄로 이동합니다.

## 1. 수식

인라인 수식은 $E = mc^2$ 또는 \(\nabla \cdot \mathbf{B} = 0\) 처럼 씁니다. 가격 표기 $5, $10 은 수식으로 바뀌지 않습니다.

\begin{equation}
\mathcal{L}(\theta) = -\frac{1}{N}\sum_{i=1}^{N} \left[ y_i \log \hat{y}_i + (1-y_i)\log(1-\hat{y}_i) \right]
\label{eq:bce}
\end{equation}

식 \eqref{eq:bce}는 이진 교차 엔트로피입니다.

\begin{align}
\hat{\beta} &= \argmin_{\beta \in \R^p} \norm{y - X\beta}^2 + \lambda \norm{\beta}_1 \\
\sigma^2 &= \frac{1}{n-p}\sum_{i=1}^{n} (y_i - \hat{y}_i)^2
\end{align}

## 2. 표

@tbl:sensors 처럼 본문에서 표 번호를 참조할 수 있습니다. 엑셀에서 복사한 셀을 붙여넣으면 표로 바뀝니다.

| 센서 | 해상도 (m) | 밴드 수 | 비고 |
|:-----|----------:|-------:|------|
| Sentinel-2 MSI | 10 | 13 | NDVI $= \frac{NIR - R}{NIR + R}$ |
| Landsat 9 OLI-2 | 30 | 11 | 노름 $\|x\|_2$ 도 표 안에서 표시됩니다 |

Table: 위성 센서 비교 {#tbl:sensors}

## 3. 그림과 인용

- 그림: `![캡션](images/a.png){#fig:site}` → "그림 1. 캡션", 본문에서 `@fig:site`
- 캡처한 이미지를 **붙여넣거나 끌어다 놓으면** `images/` 폴더에 저장되고 링크가 들어갑니다.
- 인용: 문서 맨 위에 `bibliography: refs.bib` 를 적고 `[@kim2024]` 로 인용하면 참고문헌 목록이 자동으로 붙습니다.

## 4. 다이어그램 · 코드

```mermaid
graph LR
  A[위성 영상] --> B[전처리] --> C[탐지 모델] --> D[결과 지도]
```

```python
import numpy as np

def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    return (nir - red) / (nir + red + 1e-6)
```

## 5. 기타

- [x] 수식 · 표 · 그림 번호 · 인용
- [x] Mermaid · 콜아웃 · 각주[^1]
- [ ] 여러분의 문서

> [!NOTE]
> 콜아웃은 `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` 을 지원합니다.

[^1]: 각주는 이렇게 표시됩니다.

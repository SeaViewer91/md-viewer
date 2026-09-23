# MD Viewer에 오신 것을 환영합니다

왼쪽 **탐색기**에서 폴더를 열고(`⌘/Ctrl + O`), 가운데에서 편집하면 오른쪽 **미리보기**가 바로 갱신됩니다.
이 문서는 저장되지 않은 새 문서입니다. 자유롭게 고쳐 보세요.

## 1. 수식

인라인 수식은 $E = mc^2$ 또는 \(\nabla \cdot \mathbf{B} = 0\) 처럼 씁니다. 가격 표기 $5, $10 은 수식으로 바뀌지 않습니다.

번호가 붙는 수식과 참조:

\begin{equation}
\mathcal{L}(\theta) = -\frac{1}{N}\sum_{i=1}^{N} \left[ y_i \log \hat{y}_i + (1-y_i)\log(1-\hat{y}_i) \right]
\label{eq:bce}
\end{equation}

식 \eqref{eq:bce}는 이진 교차 엔트로피입니다. 여러 줄 정렬:

\begin{align}
\hat{\beta} &= \argmin_{\beta \in \R^p} \norm{y - X\beta}^2 + \lambda \norm{\beta}_1 \label{eq:lasso} \\
\sigma^2 &= \frac{1}{n-p}\sum_{i=1}^{n} (y_i - \hat{y}_i)^2
\end{align}

디스플레이 수식:

$$
\mathbf{K} = \begin{pmatrix} k(x_1,x_1) & \cdots & k(x_1,x_n) \\ \vdots & \ddots & \vdots \\ k(x_n,x_1) & \cdots & k(x_n,x_n) \end{pmatrix}
$$

## 2. 표

| 센서 | 해상도 (m) | 밴드 수 | 재방문 주기 | 비고 |
|:-----|----------:|-------:|:----------:|------|
| Sentinel-2 MSI | 10 | 13 | 5일 | NDVI $= \frac{NIR - R}{NIR + R}$ |
| Landsat 9 OLI-2 | 30 | 11 | 16일 | 열적외 포함 |
| PlanetScope | 3 | 8 | 1일 | 상용 |

## 3. 코드

```python
import numpy as np

def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    return (nir - red) / (nir + red + 1e-6)
```

## 4. 기타

- [x] 수식·표·코드 렌더링
- [ ] Mermaid 다이어그램 (다음 단계)

> 인용문도 지원합니다.[^1]

[^1]: 각주는 이렇게 표시됩니다.
